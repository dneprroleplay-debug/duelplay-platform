import { createServer } from 'node:net';
import dgram from 'node:dgram';
import { existsSync, lstatSync, realpathSync, statfsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import os from 'node:os';

export const INSTANCE_PREFLIGHT_MAX_AGE_MS = 30_000;
const SOURCE = 'local-instance-preflight-v1';
const RESOURCE_KEYS = ['memoryBytes', 'cpuMilli', 'diskBytes', 'inodes'];

function statusFact(status, details = {}, reason = null, observedAt = Date.now()) {
  return { status, source: SOURCE, observedAt, reason, ...details };
}

function tcpPortAvailable(port) {
  return new Promise(resolveResult => {
    const server = createServer();
    let settled = false;
    const finish = fact => {
      if (settled) return;
      settled = true;
      resolveResult(fact);
    };
    server.once('error', error => finish(statusFact(error.code === 'EADDRINUSE' ? 'FAILED' : 'UNKNOWN', { errorCode: error.code ?? null }, error.code === 'EADDRINUSE' ? 'TCP_PORT_IN_USE' : 'TCP_PROBE_' + (error.code ?? 'ERROR'))));
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
      server.close(error => finish(error
        ? statusFact('UNKNOWN', { errorCode: error.code ?? null }, 'TCP_PROBE_CLOSE_' + (error.code ?? 'ERROR'))
        : statusFact('PASS', { bindAddress: '0.0.0.0' })));
    });
  });
}

function udpPortAvailable(port) {
  return new Promise(resolveResult => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    let settled = false;
    const finish = fact => {
      if (settled) return;
      settled = true;
      resolveResult(fact);
    };
    socket.once('error', error => finish(statusFact(error.code === 'EADDRINUSE' ? 'FAILED' : 'UNKNOWN', { errorCode: error.code ?? null }, error.code === 'EADDRINUSE' ? 'UDP_PORT_IN_USE' : 'UDP_PROBE_' + (error.code ?? 'ERROR'))));
    socket.bind({ port, address: '0.0.0.0', exclusive: true }, () => {
      socket.close(error => finish(error
        ? statusFact('UNKNOWN', { errorCode: error.code ?? null }, 'UDP_PROBE_CLOSE_' + (error.code ?? 'ERROR'))
        : statusFact('PASS', { bindAddress: '0.0.0.0' })));
    });
  });
}

function within(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

function canonicalFuturePath(input) {
  let cursor = resolve(input);
  const suffix = [];
  while (true) {
    try {
      lstatSync(cursor);
      return resolve(realpathSync.native(cursor), ...suffix.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      cursor = parent;
    }
  }
}

function collectPaths({ root, allowedRoot, sharedGameRoot, existingRoots = [] }, observedAt) {
  try {
    if (!allowedRoot || !sharedGameRoot) return statusFact('UNKNOWN', {}, 'ALLOWED_ROOT_OR_SHARED_GAME_ROOT_NOT_PROVIDED', observedAt);
    const allowed = realpathSync.native(resolve(allowedRoot));
    if (!lstatSync(allowed).isDirectory()) return statusFact('UNKNOWN', {}, 'ALLOWED_ROOT_NOT_DIRECTORY', observedAt);
    const canonicalRoot = canonicalFuturePath(root);
    const canonicalShared = canonicalFuturePath(sharedGameRoot);
    const sharedStat = lstatSync(resolve(sharedGameRoot));
    const rootExists = existsSync(resolve(root));
    const canonicalExistingRoots = existingRoots.map(canonicalFuturePath);
    const rootConflict = canonicalExistingRoots.some(existing => existing === canonicalRoot || within(existing, canonicalRoot) || within(canonicalRoot, existing));
    const escapes = !within(allowed, canonicalRoot) || !within(allowed, canonicalShared);
    const sharedValid = sharedStat.isDirectory() && within(allowed, canonicalShared);
    const status = escapes || rootExists || rootConflict || !sharedValid ? 'FAILED' : 'PASS';
    const reason = escapes ? 'CANONICAL_PATH_ESCAPES_ALLOWED_ROOT'
      : rootExists ? 'INSTANCE_ROOT_ALREADY_EXISTS'
        : rootConflict ? 'CANONICAL_PATH_CONFLICTS_WITH_EXISTING_INSTANCE'
        : !sharedValid ? 'SHARED_GAME_ROOT_MISSING_OR_INVALID' : null;
    return statusFact(status, { allowedRoot: allowed, canonicalRoot, canonicalSharedGameRoot: canonicalShared, canonicalExistingRoots, instanceRootExists: rootExists }, reason, observedAt);
  } catch (error) {
    return statusFact('UNKNOWN', {}, 'PATH_PROBE_' + (error.code ?? 'ERROR'), observedAt);
  }
}

function readCgroupValue(file) {
  try { return readFileSync(file, 'utf8').trim(); } catch { return null; }
}

function collectResources(allowedRoot, sharedGameRoot, requirements, observedAt) {
  try {
    if (!allowedRoot || !sharedGameRoot) return statusFact('UNKNOWN', {}, 'RESOURCE_PATHS_NOT_PROVIDED', observedAt);
    const fsStats = [statfsSync(allowedRoot), statfsSync(sharedGameRoot)];
    let memoryBytes = os.freemem();
    let cpuMilli = (os.availableParallelism?.() ?? os.cpus().length) * 1000;
    let limitation = 'CPU is available logical capacity, not instantaneous idle CPU.';
    if (process.platform === 'linux') {
      const memoryMax = readCgroupValue('/sys/fs/cgroup/memory.max');
      const memoryCurrent = Number(readCgroupValue('/sys/fs/cgroup/memory.current'));
      if (memoryMax && memoryMax !== 'max' && Number.isFinite(memoryCurrent)) memoryBytes = Math.min(memoryBytes, Math.max(0, Number(memoryMax) - memoryCurrent));
      const cpuMax = readCgroupValue('/sys/fs/cgroup/cpu.max');
      if (cpuMax && cpuMax !== 'max') {
        const [quota, period] = cpuMax.split(/\s+/).map(Number);
        if (quota > 0 && period > 0) cpuMilli = Math.min(cpuMilli, Math.floor(quota * 1000 / period));
      }
      if (memoryMax === null || cpuMax === null) return statusFact('UNKNOWN', {}, 'CGROUP_V2_RESOURCE_LIMITS_UNAVAILABLE', observedAt);
      limitation = 'Readable cgroup v2 limits applied; CPU is quota capacity, not instantaneous idle CPU.';
    }
    const resources = {
      memoryBytes,
      cpuMilli,
      diskBytes: Math.min(...fsStats.map(item => Math.floor(item.bavail * item.bsize))),
      inodes: Math.min(...fsStats.map(item => item.ffree)),
    };
    if (!requirements || !RESOURCE_KEYS.every(key => Number.isSafeInteger(requirements[key]) && requirements[key] >= 0)) {
      return statusFact('UNKNOWN', { resources, limitation }, 'VALID_RESOURCE_REQUIREMENTS_NOT_PROVIDED', observedAt);
    }
    const failed = RESOURCE_KEYS.filter(key => resources[key] < requirements[key]);
    return statusFact(failed.length ? 'FAILED' : 'PASS', { resources, limitation, insufficient: failed }, failed.length ? 'INSUFFICIENT_' + failed.join('_') : null, observedAt);
  } catch (error) {
    return statusFact('UNKNOWN', {}, 'RESOURCE_PROBE_' + (error.code ?? 'ERROR'), observedAt);
  }
}

export async function collectInstancePreflightFacts({ id, root, allowedRoot, sharedGameRoot, existingRoots = [], gamePort, managerPort, requirements }) {
  const observedAt = Date.now();
  const validPorts = Number.isInteger(gamePort) && gamePort > 0 && gamePort <= 65535 && Number.isInteger(managerPort) && managerPort > 0 && managerPort <= 65535;
  const [gamePortFact, managerPortFact] = validPorts
    ? await Promise.all([udpPortAvailable(gamePort), tcpPortAvailable(managerPort)])
    : [statusFact('UNKNOWN', {}, 'INVALID_PORT', observedAt), statusFact('UNKNOWN', {}, 'INVALID_PORT', observedAt)];
  const portStatus = gamePortFact.status === 'FAILED' || managerPortFact.status === 'FAILED' ? 'FAILED'
    : gamePortFact.status === 'PASS' && managerPortFact.status === 'PASS' ? 'PASS' : 'UNKNOWN';
  return {
    source: SOURCE,
    observedAt,
    id,
    gamePort,
    managerPort,
    ports: statusFact(portStatus, { game: gamePortFact, manager: managerPortFact }, portStatus === 'PASS' ? null : 'PORT_FACTS_REQUIRE_REVIEW', observedAt),
    paths: collectPaths({ root, allowedRoot, sharedGameRoot, existingRoots }, observedAt),
    resources: collectResources(allowedRoot, sharedGameRoot, requirements, observedAt),
    registration: statusFact('UNKNOWN', {}, 'NO_READ_ONLY_DATABASE_REGISTRATION_SOURCE_CONFIGURED', observedAt),
  };
}

export function currentFactStatus(fact, now = Date.now()) {
  if (!fact || fact.source !== SOURCE || !Number.isFinite(fact.observedAt)) return 'UNKNOWN';
  const age = now - fact.observedAt;
  if (age < 0 || age > INSTANCE_PREFLIGHT_MAX_AGE_MS) return 'UNKNOWN';
  return ['PASS', 'FAILED'].includes(fact.status) ? fact.status : 'UNKNOWN';
}
