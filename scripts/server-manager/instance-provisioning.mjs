import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { currentFactStatus } from './instance-preflight.mjs';

const validId = value => /^cs2-[1-9]\d*$/.test(value);
function uniquePorts(servers) {
  const all = servers;
  return {
    ids: new Set(all.map(row => row.name ?? row.id).filter(Boolean)),
    roots: new Set(all.map(row => row.root ?? row.instanceRoot).filter(Boolean).map(value => resolve(value).toLowerCase())),
    allPorts: new Set(all.flatMap(row => [Number(row.port), Number(row.managerPort)]).filter(Number.isInteger)),
  };
}

function firstFree(used, start) { while (used.has(start)) start++; return start; }

export function planInstanceAdd({ servers, id, root, host, sharedGameRoot, resources, requirements, pathChecks, registration, availablePorts, preflightFacts }) {
  if (!validId(id)) throw new Error('Server ID must use cs2-N format.');
  const used = uniquePorts(servers);
  if (used.ids.has(id)) throw new Error(`Server ${id} already exists in configuration or registration.`);
  const instanceRoot = resolve(root || `/home/ubuntu/cs2/instances/${id}/root`);
  if (used.roots.has(instanceRoot.toLowerCase())) throw new Error(`Instance root already exists in configuration or registration: ${instanceRoot}`);
  const sharedRoot = sharedGameRoot ? resolve(sharedGameRoot) : null;
  const gamePort = firstFree(used.allPorts, 27015);
  used.allPorts.add(gamePort);
  const managerPort = firstFree(used.allPorts, 3010);
  const factsMatch = preflightFacts?.id === id && preflightFacts.gamePort === gamePort && preflightFacts.managerPort === managerPort;
  const factStatus = fact => factsMatch ? currentFactStatus(fact) : 'UNKNOWN';
  const portGate = factStatus(preflightFacts?.ports);
  const registrationGate = factStatus(preflightFacts?.registration);
  const resourceGate = factStatus(preflightFacts?.resources);
  const pathGate = factStatus(preflightFacts?.paths);
  const resourceSummary = preflightFacts?.resources?.resources ?? null;
  return {
    id,
    envFile: `.env.${id}`,
    service: `duelplay-cs2-manager@${id}.service`,
    root: instanceRoot,
    sharedGameRoot: sharedRoot,
    host: host ?? null,
    gamePort,
    managerPort,
    gates: { identity: 'PASS', ports: portGate, paths: pathGate, resources: resourceGate, registration: registrationGate },
    resourceSnapshot: resourceSummary,
    preflightFacts: preflightFacts ?? null,
    factReasons: factsMatch ? Object.fromEntries(['ports', 'paths', 'resources', 'registration'].map(key => [key, preflightFacts[key]?.reason ?? (currentFactStatus(preflightFacts[key]) === 'UNKNOWN' ? 'MISSING_STALE_OR_INVALID_FACT' : null)])) : { all: 'PREFLIGHT_FACTS_MISSING_STALE_OR_DO_NOT_MATCH_PLAN' },
    readyToPrepare: [portGate, pathGate, resourceGate, registrationGate].every(status => status === 'PASS'),
    provisioning: 'PREPARE_ONLY_NO_MOUNT_NO_SERVICE_START_NO_API_WRITE',
  };
}

export function prepareInstanceArtifacts({ plan, stagingDir, host, sharedGameRoot }) {
  const requiredFacts = ['ports', 'paths', 'resources', 'registration'];
  const currentGates = Object.fromEntries(requiredFacts.map(key => [key, currentFactStatus(plan.preflightFacts?.[key])]));
  if (requiredFacts.some(key => currentGates[key] !== 'PASS')) throw new Error('Instance preparation blocked: ' + Object.entries(currentGates).filter(([, status]) => status !== 'PASS').map(([gate, status]) => gate + '=' + status).join(', '));
  if (!plan.readyToPrepare) throw new Error(`Instance preparation blocked: ${Object.entries(plan.gates).filter(([, status]) => status !== 'PASS').map(([gate, status]) => `${gate}=${status}`).join(', ')}`);
  if (!host || !/^[A-Za-z0-9.:-]{1,253}$/.test(host)) throw new Error('A valid public host is required.');
  if (!sharedGameRoot) throw new Error('Shared game root is required.');
  const stage = resolve(stagingDir);
  if (existsSync(stage)) throw new Error(`Staging path already exists; refusing overwrite: ${stage}`);
  mkdirSync(stage, { recursive: false, mode: 0o700 });
  const env = [
    `DUELPLAY_SERVER_ID=${plan.id}`,
    `CS2_DIR=${plan.root}`,
    `CS2_PUBLIC_HOST=${host}`,
    `CS2_PORT=${plan.gamePort}`,
    `DUELPLAY_MANAGER_PORT=${plan.managerPort}`,
    `CS2_STEAMCMD_DIR=${resolve(sharedGameRoot, '..')}`,
    'CS2_AUTO_UPDATE=false',
    `DUELPLAY_EVENT_OUTBOX_FILE=${resolve(plan.root, '..', 'state', 'technical-events.json')}`,
    '',
  ].join('\n');
  writeFileSync(resolve(stage, plan.envFile), env, { flag: 'wx', mode: 0o600 });
  writeFileSync(resolve(stage, 'registration-request.json'), `${JSON.stringify({ name: plan.id, host, port: plan.gamePort, managerPort: plan.managerPort }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  writeFileSync(resolve(stage, 'plan.json'), `${JSON.stringify({ ...plan, host, sharedGameRoot: resolve(sharedGameRoot), preparedAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { stagingDir: stage, envFile: resolve(stage, plan.envFile), registrationRequest: resolve(stage, 'registration-request.json'), planFile: resolve(stage, 'plan.json') };
}
