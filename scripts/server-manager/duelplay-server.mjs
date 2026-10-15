#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadInstanceRegistry } from './instance-registry.mjs';
import { inspectComponentRoot, repairComponents } from './component-manifest.mjs';
import { planInstanceAdd, prepareInstanceArtifacts } from './instance-provisioning.mjs';
import { collectInstancePreflightFacts } from './instance-preflight.mjs';

function usage() {
  console.log(`DuelPlay server operations (read-only by default)
  status --config-dir DIR
  check <cs2-N> --config-dir DIR [--manifest FILE]
  check-all --config-dir DIR [--manifest FILE]
  diff <cs2-N> --config-dir DIR [--manifest FILE]
  add --id cs2-N --config-dir DIR --dry-run [--root PATH --allowed-root DIR --shared-game-root DIR --requirements FILE]
  add --id cs2-N --config-dir DIR --prepare --staging-dir DIR --host HOST --allowed-root DIR --shared-game-root DIR --requirements FILE
  repair <cs2-N> --config-dir DIR --bundle-dir DIR [--backup-dir DIR --journal FILE] [--manifest FILE] [--dry-run]`);
}

function options(args) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'dry-run' || key === 'prepare') result[key] = true;
      else result[key] = args[++i];
    } else result._.push(arg);
  }
  return result;
}

function required(opts, key) {
  if (!opts[key]) throw new Error(`Missing --${key}.`);
  return opts[key];
}

function manifestAt(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function printRows(rows) {
  for (const row of rows) console.log(JSON.stringify(row));
}

async function readManagerHealth(server) {
  try {
    const response = await fetch(`http://127.0.0.1:${server.managerPort}/health`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return { managerReady: false, gameProcessReady: false, gameProcessStatus: 'UNKNOWN', healthError: `HTTP_${response.status}` };
    const health = await response.json();
    if (health.serverId !== server.name) return { managerReady: false, gameProcessReady: false, gameProcessStatus: 'UNKNOWN', healthError: 'SERVER_ID_MISMATCH' };
    return {
      managerReady: health.managerReady === true,
      gameProcessReady: health.gameProcessReady === true,
      gameProcessStatus: ['STOPPED', 'STARTING', 'READY'].includes(health.gameProcessStatus) ? health.gameProcessStatus : 'UNKNOWN',
      gameProcessPid: Number.isInteger(health.gameProcessPid) ? health.gameProcessPid : null,
      matchId: typeof health.matchId === 'string' ? health.matchId : null,
      gsiAgeMs: Number.isFinite(health.gsiAgeMs) ? health.gsiAgeMs : null,
    };
  } catch (error) {
    return { managerReady: false, gameProcessReady: false, gameProcessStatus: 'UNKNOWN', healthError: error.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE' };
  }
}

function readJsonOption(opts, key) { return opts[key] ? JSON.parse(readFileSync(resolve(opts[key]), 'utf8')) : undefined; }

async function main() {
  const opts = options(process.argv.slice(2));
  const [command, target] = opts._;
  if (!command || command === '--help' || command === 'help') { usage(); return; }
  if (command === 'add') {
    const configDir = resolve(required(opts, 'config-dir'));
    const id = required(opts, 'id');
    for (const key of ['registration', 'resources', 'paths', 'available-ports']) {
      if (opts[key] !== undefined) throw new Error('--' + key + ' snapshots are not accepted as live preflight facts.');
    }
    const servers = loadInstanceRegistry(configDir);
    const inputs = { servers, id, root: opts.root, host: opts.host, sharedGameRoot: opts['shared-game-root'] };
    const candidate = planInstanceAdd(inputs);
    const preflightFacts = await collectInstancePreflightFacts({
      id, root: candidate.root, allowedRoot: opts['allowed-root'], sharedGameRoot: candidate.sharedGameRoot,
      existingRoots: servers.map(server => server.root),
      gamePort: candidate.gamePort, managerPort: candidate.managerPort,
      requirements: readJsonOption(opts, 'requirements'),
    });
    const plan = planInstanceAdd({ ...inputs, preflightFacts });
    if (opts.prepare) {
      const prepared = prepareInstanceArtifacts({ plan, stagingDir: required(opts, 'staging-dir'), host: required(opts, 'host'), sharedGameRoot: required(opts, 'shared-game-root') });
      printRows([{ ...plan, mode: 'PREPARED_STAGING_ONLY', ...prepared, note: 'No OverlayFS mount, service start, or database registration was performed.' }]);
    } else {
      printRows([{ ...plan, mode: opts['dry-run'] ? 'DRY_RUN' : 'PLAN_ONLY', note: 'No files, mounts, services, or API records are changed.' }]);
      if (!opts['dry-run']) process.exitCode = 2;
    }
    return;
  }
  const configDir = resolve(required(opts, 'config-dir'));
  const servers = loadInstanceRegistry(configDir);
  if (command === 'status') {
    const rows = await Promise.all(servers.map(async server => ({ id: server.name, gamePort: server.port, managerPort: server.managerPort, root: server.root, source: server.env, ...await readManagerHealth(server) })));
    printRows(rows);
    return;
  }
  if (!['check', 'check-all', 'diff', 'repair'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const manifestPath = opts.manifest ? resolve(opts.manifest) : fileURLToPath(new URL('./component-bundle/manifest.json', import.meta.url));
  const manifest = manifestAt(manifestPath);
  const selected = command === 'check-all' ? servers : servers.filter(server => server.name === target);
  if (!selected.length) throw new Error(command === 'check-all' ? 'No registered instances.' : `Unknown server: ${target}`);
  if (command === 'repair') {
    const dryRun = Boolean(opts['dry-run']);
    const result = repairComponents({ root: selected[0].root, bundleRoot: resolve(required(opts, 'bundle-dir')), backupRoot: dryRun ? undefined : resolve(required(opts, 'backup-dir')), journalFile: dryRun ? undefined : resolve(required(opts, 'journal')), manifest, dryRun });
    printRows(result.plan.map(row => ({ server: selected[0].name, ...row, action: result.dryRun ? 'WOULD_REPAIR' : 'RESTORED' })));
    if (!result.plan.length) console.log(JSON.stringify({ server: selected[0].name, status: 'PASS', message: 'No component drift.' }));
    return;
  }
  const reports = selected.flatMap(server => inspectComponentRoot(server.root, manifest).map(row => ({ server: server.name, ...row })));
  printRows(reports);
  if (reports.some(row => row.status !== 'PASS')) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`duelplay-server: ${error.message}`);
    process.exitCode = 1;
  });
}
