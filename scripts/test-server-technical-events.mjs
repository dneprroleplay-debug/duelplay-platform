import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import dgram from 'node:dgram';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTechnicalEventOutbox } from './server-manager/technical-event-outbox.mjs';
import { loadInstanceRegistry } from './server-manager/instance-registry.mjs';
import { compareComponentParity } from './server-manager/component-check.mjs';
import { buildComponentManifest, createRepairPlan, inspectComponentRoot, repairComponents, validateComponentManifest, verifyPartialRepairState, writeManifest } from './server-manager/component-manifest.mjs';
import { managerHealthSnapshot } from './server-manager/manager-health.mjs';
import { planInstanceAdd, prepareInstanceArtifacts } from './server-manager/instance-provisioning.mjs';
import { collectInstancePreflightFacts } from './server-manager/instance-preflight.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'duelplay-server-events-'));
try {
  const queueFile = path.join(root, 'outbox', 'cs2-1.json');
  let calls = 0;
  const offline = createTechnicalEventOutbox({ apiUrl: 'https://example.invalid/', secret: 'test-secret', serverId: 'cs2-1', filePath: queueFile, fetchImpl: async () => { calls++; throw new Error('offline'); } });
  assert.equal(await offline.emit({ source: 'manager', category: 'api.failure', severity: 'ERROR', message: 'request token=abc123 failed', details: { safe: 'ok', apiToken: 'hidden' } }), true);
  let queued = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].event.message, 'request token=[redacted] failed');
  assert.equal('apiToken' in queued[0].event.details, false);
  assert.equal(calls, 1);

  let accepted = 0;
  const online = createTechnicalEventOutbox({ apiUrl: 'https://example.invalid', secret: 'test-secret', serverId: 'cs2-1', filePath: queueFile, fetchImpl: async (_url, request) => { accepted++; assert.equal(request.method, 'POST'); return { ok: true, status: 201 }; } });
  await online.flush();
  assert.equal(accepted, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(queueFile, 'utf8')), []);
  const deadLetterFile = path.join(root, 'outbox', 'dead-letter.json');
  let dropNotice;
  const failingOutbox = createTechnicalEventOutbox({ apiUrl: 'https://example.invalid', secret: 'test-secret', serverId: 'cs2-1', filePath: path.join(root, 'outbox', 'failing.json'), deadLetterFile, fetchImpl: async () => { throw new Error('socket failed'); }, onDrop: notice => { dropNotice = notice; } });
  await failingOutbox.emit({ source: 'manager', category: 'test.failure', message: 'retry me', severity: 'ERROR' });
  for (let attempt = 1; attempt < 5; attempt++) await failingOutbox.flush();
  assert.equal(JSON.parse(fs.readFileSync(deadLetterFile, 'utf8'))[0].attempts, 5);
  assert.equal(dropNotice.reason, 'NETWORK_ERROR');
  assert.equal(dropNotice.deadLetterSaved, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'outbox', 'failing.json'), 'utf8')), []);

  const overflowQueueFile = path.join(root, 'outbox', 'overflow.json');
  const overflowDeadLetterFile = `${overflowQueueFile}.dead-letter.json`;
  fs.mkdirSync(path.dirname(overflowQueueFile), { recursive: true });
  fs.writeFileSync(overflowDeadLetterFile, JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ event: { eventId: `old-${index}` }, reason: 'fixture' }))));
  let overflowNotices = 0;
  const overflowReasons = [];
  let rejectFirstRequest;
  let firstRequestPending = true;
  const overflowOutbox = createTechnicalEventOutbox({
    apiUrl: 'https://example.invalid', secret: 'test-secret', serverId: 'cs2-1', filePath: overflowQueueFile,
    fetchImpl: async () => {
      if (firstRequestPending) return new Promise((_resolve, reject) => { firstRequestPending = false; rejectFirstRequest = reject; });
      throw new Error('offline');
    },
    onDrop: notice => { overflowNotices++; overflowReasons.push(notice.reason); throw new Error('diagnostic sink unavailable'); },
  });
  const pendingEmits = [overflowOutbox.emit({ source: 'manager', category: 'overflow.fixture', message: 'event-0' })];
  await new Promise(resolve => setImmediate(resolve)); // hold delivery while filling the bounded queue
  for (let index = 1; index < 201; index++) pendingEmits.push(overflowOutbox.emit({ source: 'manager', category: 'overflow.fixture', message: `event-${index}` }));
  const queueAtCapacity = JSON.parse(fs.readFileSync(overflowQueueFile, 'utf8'));
  const diagnosticsAtCapacity = overflowOutbox.readDiagnostics();
  const deadLettersAtCapacity = JSON.parse(fs.readFileSync(overflowDeadLetterFile, 'utf8'));
  rejectFirstRequest(new Error('offline'));
  await Promise.all(pendingEmits);
  const boundedQueue = JSON.parse(fs.readFileSync(overflowQueueFile, 'utf8'));
  const boundedDeadLetters = JSON.parse(fs.readFileSync(overflowDeadLetterFile, 'utf8'));
  const overflowDiagnostics = overflowOutbox.readDiagnostics();
  assert.equal(queueAtCapacity.length, 200);
  assert.ok(boundedQueue.length <= 200);
  assert.equal(deadLettersAtCapacity.length, 100);
  assert.ok(deadLettersAtCapacity.some(entry => entry.reason === 'OUTBOX_OVERFLOW'));
  assert.ok(diagnosticsAtCapacity.outboxOverflows >= 1);
  assert.ok(diagnosticsAtCapacity.deadLetterEvictions >= 1);
  assert.equal(boundedDeadLetters.length, 100);
  assert.ok(overflowReasons.includes('OUTBOX_OVERFLOW'));
  assert.ok(overflowDiagnostics.lostEvents >= diagnosticsAtCapacity.lostEvents);
  assert.ok(overflowDiagnostics.outboxOverflows >= 1);
  assert.ok(overflowDiagnostics.deadLetterEvictions >= 1);
  assert.ok(overflowNotices > 0 && overflowNotices < 500); // failed callbacks do not trigger retries or loops

  const configDir = path.join(root, 'configs');
  fs.mkdirSync(configDir);
  for (let index = 1; index <= 4; index++) {
    const envName = index === 1 ? '.env' : `.env.cs2-${index}`;
    fs.writeFileSync(path.join(configDir, envName), `DUELPLAY_SERVER_ID=cs2-${index}\nCS2_DIR=/tmp/instances/cs2-${index}/root\nCS2_PORT=${27014 + index}\nDUELPLAY_MANAGER_PORT=${3009 + index}\n`);
  }
  assert.deepEqual(loadInstanceRegistry(configDir).map(server => server.name), ['cs2-1', 'cs2-2', 'cs2-3', 'cs2-4']);
  fs.writeFileSync(path.join(configDir, '.env.cs2-4'), 'DUELPLAY_SERVER_ID=cs2-3\nCS2_DIR=/tmp/instances/cs2-4/root\nCS2_PORT=27018\nDUELPLAY_MANAGER_PORT=3013\n');
  assert.throws(() => loadInstanceRegistry(configDir), /Duplicate DUELPLAY_SERVER_ID/);
  fs.writeFileSync(path.join(configDir, '.env.cs2-4'), 'DUELPLAY_SERVER_ID=cs2-4\nCS2_DIR=/tmp/instances/cs2-4/root\nCS2_PORT=27017\nDUELPLAY_MANAGER_PORT=3013\n');
  assert.throws(() => loadInstanceRegistry(configDir), /Duplicate CS2_PORT/);
  fs.writeFileSync(path.join(configDir, '.env.cs2-4'), 'DUELPLAY_SERVER_ID=cs2-4\nCS2_DIR=/tmp/instances/cs2-4/root\nCS2_PORT=27018\nDUELPLAY_MANAGER_PORT=3013\n');
  fs.writeFileSync(path.join(configDir, '.env.cs2-3'), 'DUELPLAY_SERVER_ID=cs2-3\nCS2_DIR=/tmp/instances/cs2-4/root\nCS2_PORT=27017\nDUELPLAY_MANAGER_PORT=3012\n');
  assert.throws(() => loadInstanceRegistry(configDir), /Duplicate CS2_DIR/);
  const fixtureServers = [1, 2, 3].map(index => ({ name: `cs2-${index}`, root: `/srv/instances/cs2-${index}/root`, port: 27014 + index, managerPort: 3009 + index }));
  const fixtureRequirements = { memoryBytes: 1_000_000_000, cpuMilli: 1000, diskBytes: 1_000_000_000, inodes: 1000 };
  const fixtureResources = { memoryBytes: 4_000_000_000, cpuMilli: 4000, diskBytes: 20_000_000_000, inodes: 100_000 };
  const fixtureRegistration = { reachable: true, canRegister: true, servers: fixtureServers };
  const fixturePathChecks = { instancePathFree: true, sharedGameAvailable: true, overlaySourceVerified: true, individualConfigSeedAvailable: true, systemdTemplateAvailable: true };
  const fixtureGameRoot = path.join(root, 'game');
  fs.mkdirSync(fixtureGameRoot);
  const addPlan = planInstanceAdd({ servers: fixtureServers, id: 'cs2-4', root: path.join(root, 'cs2-4', 'root'), sharedGameRoot: fixtureGameRoot, host: '127.0.0.1', resources: fixtureResources, requirements: fixtureRequirements, pathChecks: fixturePathChecks, registration: fixtureRegistration, availablePorts: { game: true, manager: true } });
  assert.equal(addPlan.gamePort, 27018);
  assert.equal(addPlan.managerPort, 3013);
  assert.equal(addPlan.readyToPrepare, false);
  assert.equal(addPlan.gates.registration, 'UNKNOWN');
  assert.throws(() => planInstanceAdd({ servers: fixtureServers, id: 'cs2-2' }), /already exists/);
  assert.throws(() => planInstanceAdd({ servers: fixtureServers, id: 'cs2-4', root: fixtureServers[0].root }), /root already exists/);
  assert.equal(planInstanceAdd({ servers: fixtureServers, id: 'cs2-4', registration: fixtureRegistration, resources: { ...fixtureResources, memoryBytes: 1 }, requirements: fixtureRequirements, pathChecks: fixturePathChecks, availablePorts: { game: false, manager: true } }).gates.ports, 'UNKNOWN');
  assert.equal(planInstanceAdd({ servers: fixtureServers, id: 'cs2-4', registration: fixtureRegistration, resources: { ...fixtureResources, memoryBytes: 1 }, requirements: fixtureRequirements, pathChecks: fixturePathChecks, availablePorts: { game: true, manager: true } }).gates.resources, 'UNKNOWN');
  assert.equal(planInstanceAdd({ servers: fixtureServers, id: 'cs2-4' }).readyToPrepare, false);
  const stagingDir = path.join(root, 'prepared-cs2-4');
  assert.throws(() => prepareInstanceArtifacts({ plan: addPlan, stagingDir, host: '127.0.0.1', sharedGameRoot: fixtureGameRoot }), /Instance preparation blocked/);
  assert.equal(fs.existsSync(stagingDir), false);

  const zeroRequirements = { memoryBytes: 0, cpuMilli: 0, diskBytes: 0, inodes: 0 };
  const occupiedUdp = dgram.createSocket({ type: 'udp4', reuseAddr: false });
  await new Promise(resolve => occupiedUdp.bind(0, '0.0.0.0', resolve));
  const occupiedUdpPort = occupiedUdp.address().port;
  const occupiedPortFacts = await collectInstancePreflightFacts({
    id: 'cs2-9', root: path.join(root, 'cs2-9', 'root'), allowedRoot: root, sharedGameRoot: fixtureGameRoot,
    gamePort: occupiedUdpPort, managerPort: 3013, requirements: zeroRequirements,
  });
  assert.equal(occupiedPortFacts.ports.status, 'FAILED');
  assert.equal(occupiedPortFacts.ports.game.reason, 'UDP_PORT_IN_USE');
  occupiedUdp.close();
  const occupiedTcp = net.createServer();
  await new Promise(resolve => occupiedTcp.listen(0, '0.0.0.0', resolve));
  const occupiedTcpPort = occupiedTcp.address().port;
  const occupiedManagerFacts = await collectInstancePreflightFacts({
    id: 'cs2-9', root: path.join(root, 'cs2-9', 'root'), allowedRoot: root, sharedGameRoot: fixtureGameRoot,
    gamePort: 27030, managerPort: occupiedTcpPort, requirements: zeroRequirements,
  });
  assert.equal(occupiedManagerFacts.ports.manager.status, 'FAILED');
  assert.equal(occupiedManagerFacts.ports.manager.reason, 'TCP_PORT_IN_USE');
  occupiedTcp.close();

  const pathTestRoot = path.join(root, 'path-check');
  const allowedRoot = path.join(pathTestRoot, 'allowed');
  const outsideRoot = path.join(pathTestRoot, 'outside');
  const allowedGame = path.join(allowedRoot, 'game');
  fs.mkdirSync(allowedGame, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  const escapeLink = path.join(allowedRoot, 'escape');
  fs.symlinkSync(outsideRoot, escapeLink, process.platform === 'win32' ? 'junction' : 'dir');
  const escapedFacts = await collectInstancePreflightFacts({
    id: 'cs2-10', root: path.join(escapeLink, 'cs2-10', 'root'), allowedRoot, sharedGameRoot: allowedGame,
    gamePort: 0, managerPort: 0, requirements: zeroRequirements,
  });
  assert.equal(escapedFacts.paths.status, 'FAILED');
  assert.equal(escapedFacts.paths.reason, 'CANONICAL_PATH_ESCAPES_ALLOWED_ROOT');
  assert.equal(escapedFacts.registration.status, 'UNKNOWN');
  assert.equal(escapedFacts.registration.reason, 'NO_READ_ONLY_DATABASE_REGISTRATION_SOURCE_CONFIGURED');

  const staleFacts = await collectInstancePreflightFacts({
    id: 'cs2-11', root: path.join(root, 'cs2-11', 'root'), allowedRoot: root, sharedGameRoot: fixtureGameRoot,
    gamePort: 27030, managerPort: 3030, requirements: zeroRequirements,
  });
  staleFacts.paths.observedAt = 0;
  const stalePlan = planInstanceAdd({ servers: fixtureServers, id: 'cs2-11', root: path.join(root, 'cs2-11', 'root'), sharedGameRoot: fixtureGameRoot, preflightFacts: staleFacts });
  assert.equal(stalePlan.gates.paths, 'UNKNOWN');

  const cliConfig = path.join(root, 'cli-config');
  fs.mkdirSync(cliConfig);
  for (const index of [1, 2, 3]) fs.writeFileSync(path.join(cliConfig, `.env.cs2-${index}`), `DUELPLAY_SERVER_ID=cs2-${index}\nCS2_DIR=${path.join(root, `cli-instance-${index}`)}\nCS2_PORT=${27014 + index}\nDUELPLAY_MANAGER_PORT=${3009 + index}\n`);
  const cliData = path.join(root, 'cli-data');
  fs.mkdirSync(cliData);
  const cliFiles = {
    registration: { reachable: true, canRegister: true, servers: fixtureServers },
    resources: fixtureResources,
    requirements: fixtureRequirements,
    paths: fixturePathChecks,
    'available-ports': { game: true, manager: true },
  };
  for (const [name, value] of Object.entries(cliFiles)) fs.writeFileSync(path.join(cliData, `${name}.json`), JSON.stringify(value));
  const cli = fileURLToPath(new URL('./server-manager/duelplay-server.mjs', import.meta.url));
  const cliInstanceRoot = path.join(root, 'cli-instance-4', 'root');
  const baseArgs = ['add', '--id', 'cs2-4', '--config-dir', cliConfig, '--root', cliInstanceRoot, '--allowed-root', root, '--shared-game-root', fixtureGameRoot, '--requirements', path.join(cliData, 'requirements.json')];
  const runCli = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  const validCliPlan = runCli([...baseArgs, '--dry-run']);
  assert.equal(validCliPlan.status, 0, validCliPlan.stderr);
  assert.equal(JSON.parse(validCliPlan.stdout).readyToPrepare, false);
  assert.equal(JSON.parse(validCliPlan.stdout).gates.registration, 'UNKNOWN');
  assert.equal(runCli(['add', '--id', 'cs2-2', '--config-dir', cliConfig, '--dry-run']).status, 1);
  const blockedRegistration = { ...cliFiles.registration, canRegister: false };
  fs.writeFileSync(path.join(cliData, 'registration.json'), JSON.stringify(blockedRegistration));
  const registrationCliPlan = runCli([...baseArgs, '--dry-run']);
  assert.equal(registrationCliPlan.status, 0);
  assert.equal(JSON.parse(registrationCliPlan.stdout).gates.registration, 'UNKNOWN');
  fs.writeFileSync(path.join(cliData, 'registration.json'), JSON.stringify(cliFiles.registration));
  fs.writeFileSync(path.join(cliData, 'requirements.json'), JSON.stringify({ ...fixtureRequirements, memoryBytes: Number.MAX_SAFE_INTEGER }));
  const resourceCliPlan = runCli([...baseArgs, '--dry-run']);
  assert.equal(JSON.parse(resourceCliPlan.stdout).gates.resources, 'FAILED');
  fs.writeFileSync(path.join(cliData, 'requirements.json'), JSON.stringify(fixtureRequirements));
  const occupiedRoot = path.join(root, 'occupied-cli-root');
  fs.mkdirSync(occupiedRoot);
  const pathCliPlan = runCli([...baseArgs, '--root', occupiedRoot, '--dry-run']);
  assert.equal(JSON.parse(pathCliPlan.stdout).gates.paths, 'FAILED');
  const duplicatePortConfig = path.join(root, 'cli-duplicate-ports');
  fs.mkdirSync(duplicatePortConfig);
  fs.copyFileSync(path.join(cliConfig, '.env.cs2-1'), path.join(duplicatePortConfig, '.env.cs2-1'));
  fs.copyFileSync(path.join(cliConfig, '.env.cs2-2'), path.join(duplicatePortConfig, '.env.cs2-2'));
  fs.writeFileSync(path.join(duplicatePortConfig, '.env.cs2-3'), `DUELPLAY_SERVER_ID=cs2-3\nCS2_DIR=${path.join(root, 'cli-instance-3')}\nCS2_PORT=27016\nDUELPLAY_MANAGER_PORT=3012\n`);
  assert.match(runCli(['add', '--id', 'cs2-4', '--config-dir', duplicatePortConfig, '--dry-run']).stderr, /Duplicate CS2_PORT/);
  fs.writeFileSync(path.join(cliData, 'resources.json'), JSON.stringify(fixtureResources));
  const cliStaging = path.join(root, 'cli-prepared-cs2-4');
  const prepareArgs = [...baseArgs, '--prepare', '--staging-dir', cliStaging, '--host', '127.0.0.1', '--shared-game-root', fixtureGameRoot];
  const prepareResult = runCli(prepareArgs);
  assert.equal(prepareResult.status, 1);
  assert.match(prepareResult.stderr, /registration=UNKNOWN/);
  assert.equal(fs.existsSync(cliStaging), false);

  const idleHealth = managerHealthSnapshot({ serverId: 'cs2-4', gamePort: 27018, managerPort: 3013, current: null, readyAt: 0, now: 1000 });
  assert.equal(idleHealth.managerReady, true);
  assert.equal(idleHealth.gameProcessReady, false);
  assert.equal(idleHealth.gameProcessStatus, 'STOPPED');
  const runningHealth = managerHealthSnapshot({ serverId: 'cs2-4', gamePort: 27018, managerPort: 3013, current: { id: 'fixture-match', port: 27018, process: { pid: 321, exitCode: null, signalCode: null } }, readyAt: 900, lastGsiAt: 950, now: 1000 });
  assert.equal(runningHealth.gameProcessReady, true);
  assert.equal(runningHealth.gameProcessPid, 321);
  assert.equal(runningHealth.gsiAgeMs, 50);

  const servers = [1, 2, 3].map(index => ({ name: `cs2-${index}`, root: path.join(root, `root-${index}`) }));
  const componentFixtures = [
    { path: 'csgo/addons/example/plugin.bin', component: 'fixture' },
    { path: 'csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly.dll', component: 'grenade root copy' },
    { path: 'csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.dll', component: 'grenade nested copy' },
  ];
  for (const server of servers) {
    for (const fixture of componentFixtures) {
      fs.mkdirSync(path.dirname(path.join(server.root, fixture.path)), { recursive: true });
      fs.writeFileSync(path.join(server.root, fixture.path), 'same verified fixture');
    }
  }
  assert.ok(compareComponentParity(servers, componentFixtures).every(result => result.status === 'PASS'));
  const nestedGrenadeCopy = componentFixtures[2].path;
  fs.writeFileSync(path.join(servers[1].root, nestedGrenadeCopy), 'different nested copy');
  assert.equal(compareComponentParity(servers, componentFixtures)[2].status, 'DRIFT');
  fs.rmSync(path.join(servers[1].root, nestedGrenadeCopy));
  assert.equal(compareComponentParity(servers, componentFixtures)[2].status, 'MISSING');

  const updater = fs.readFileSync(new URL('./server-manager/update-all.mjs', import.meta.url), 'utf8');
  assert.match(updater, /\['grenade plugin', 'csgo\/addons\/counterstrikesharp\/plugins\/DuelPlayGrenadeOnly\/DuelPlayGrenadeOnly\.dll'\]/);
  assert.match(updater, /manifest\.approval !== 'APPROVED'/);
  assert.ok(updater.indexOf('verifyPerServerComponents();') < updater.indexOf('await setMaintenance(true);'));
  assert.doesNotMatch(updater, /copyFileSync\([^\n]*DuelPlayGrenadeOnly/);
  const draftManifest = JSON.parse(fs.readFileSync(new URL('./server-manager/component-bundle/manifest.json', import.meta.url), 'utf8'));
  assert.equal(draftManifest.approval, 'UNVERIFIED');
  assert.ok(draftManifest.components.some(item => item.path.endsWith('/plugins/DuelPlayGrenadeOnly.dll')));
  assert.ok(draftManifest.components.some(item => item.path.endsWith('/plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.dll')));
  assert.ok(inspectComponentRoot(servers[0].root, draftManifest).every(item => ['UNKNOWN', 'MISSING'].includes(item.status)));
  assert.throws(() => createRepairPlan(servers[0].root, root, draftManifest), /not approved/);
  assert.throws(() => validateComponentManifest({ ...draftManifest, components: [{ name: 'bad', path: 'csgo/gameinfo.gi' }] }), /Instance-specific configuration/);
  assert.throws(() => validateComponentManifest({ ...draftManifest, components: [{ name: 'bad', path: '../outside.dll' }] }), /escapes its root/);
  const symlinkRoot = path.join(root, 'symlink-root');
  const outsideAddons = path.join(root, 'outside-addons');
  fs.mkdirSync(path.join(symlinkRoot, 'csgo'), { recursive: true });
  fs.mkdirSync(path.join(outsideAddons, 'example'), { recursive: true });
  fs.writeFileSync(path.join(outsideAddons, 'example', 'loader.bin'), 'outside-root-original');
  fs.symlinkSync(outsideAddons, path.join(symlinkRoot, 'csgo', 'addons'), process.platform === 'win32' ? 'junction' : 'dir');
  const symlinkManifest = { schemaVersion: 1, bundleVersion: 'fixture-symlink', approval: 'APPROVED', components: [{ name: 'fixture loader', path: 'csgo/addons/example/loader.bin', version: 'fixture', artifact: 'example/loader.bin', sha256: '0'.repeat(64) }] };
  assert.equal(inspectComponentRoot(symlinkRoot, symlinkManifest)[0].status, 'FAILED');
  assert.throws(() => createRepairPlan(symlinkRoot, root, symlinkManifest), /status FAILED/);
  assert.equal(fs.readFileSync(path.join(outsideAddons, 'example', 'loader.bin'), 'utf8'), 'outside-root-original');
  const repairRoot = path.join(root, 'repair-root');
  const bundleRoot = path.join(root, 'bundle');
  const repairPath = 'csgo/addons/example/loader.bin';
  fs.mkdirSync(path.dirname(path.join(repairRoot, repairPath)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(bundleRoot, repairPath)), { recursive: true });
  fs.writeFileSync(path.join(repairRoot, repairPath), 'drifted');
  fs.writeFileSync(path.join(bundleRoot, repairPath), 'approved fixture artifact');
  const generatedManifest = buildComponentManifest({ bundleRoot, bundleVersion: 'fixture-generated', sourceDescription: 'test fixture only', components: [{ name: 'fixture loader', path: repairPath, artifact: repairPath, version: 'fixture' }] });
  assert.equal(generatedManifest.approval, 'UNVERIFIED');
  assert.equal(generatedManifest.components[0].sha256, createHash('sha256').update('approved fixture artifact').digest('hex'));
  const generatedManifestFile = path.join(root, 'generated-manifest.json');
  writeManifest(generatedManifestFile, generatedManifest);
  assert.equal(JSON.parse(fs.readFileSync(generatedManifestFile, 'utf8')).bundleVersion, 'fixture-generated');
  const approvedFixture = {
    schemaVersion: 1, bundleVersion: 'fixture-v1', approval: 'APPROVED',
    components: [{ name: 'fixture loader', path: repairPath, version: 'fixture', artifact: repairPath, sha256: createHash('sha256').update('approved fixture artifact').digest('hex') }],
  };
  const dryRun = repairComponents({ root: repairRoot, bundleRoot, manifest: approvedFixture, dryRun: true });
  assert.equal(dryRun.plan.length, 1);
  assert.equal(fs.readFileSync(path.join(repairRoot, repairPath), 'utf8'), 'drifted');
  assert.equal(fs.existsSync(path.join(root, 'backups')), false);
  assert.equal(fs.existsSync(path.join(root, 'repair-journal.jsonl')), false);
  const repaired = repairComponents({ root: repairRoot, bundleRoot, backupRoot: path.join(root, 'backups'), journalFile: path.join(root, 'repair-journal.jsonl'), manifest: approvedFixture, dryRun: false, now: new Date('2026-01-01T00:00:00.000Z') });
  assert.equal(repaired.after[0].status, 'PASS');
  assert.equal(fs.readFileSync(repaired.results[0].backup, 'utf8'), 'drifted');
  assert.equal(repairComponents({ root: repairRoot, bundleRoot, manifest: approvedFixture, dryRun: true }).plan.length, 0);

  function makeTwoFileRepairFixture(name) {
    const fixtureRoot = path.join(root, `${name}-root`);
    const fixtureBundle = path.join(root, `${name}-bundle`);
    const components = ['first.bin', 'second.bin'].map(file => {
      const componentPath = `components/${file}`;
      fs.mkdirSync(path.dirname(path.join(fixtureRoot, componentPath)), { recursive: true });
      fs.mkdirSync(path.dirname(path.join(fixtureBundle, componentPath)), { recursive: true });
      fs.writeFileSync(path.join(fixtureRoot, componentPath), `${name}-original-${file}`);
      fs.writeFileSync(path.join(fixtureBundle, componentPath), `${name}-approved-${file}`);
      return { name: file, path: componentPath, artifact: componentPath, version: 'fixture' };
    });
    const manifest = buildComponentManifest({ bundleRoot: fixtureBundle, bundleVersion: `${name}-fixture`, sourceDescription: 'temporary test fixture', components });
    manifest.approval = 'APPROVED';
    return { fixtureRoot, fixtureBundle, manifest };
  }

  const midFailure = makeTwoFileRepairFixture('mid-failure');
  const midBackup = path.join(root, 'mid-failure-backups');
  const midJournal = path.join(root, 'mid-failure.jsonl');
  assert.throws(() => repairComponents({ root: midFailure.fixtureRoot, bundleRoot: midFailure.fixtureBundle, backupRoot: midBackup, journalFile: midJournal, manifest: midFailure.manifest, dryRun: false, testHooks: { beforeReplace: (_operation, index) => { if (index === 1) throw new Error('INJECTED_SECOND_FILE_FAILURE'); } } }), /INJECTED_SECOND_FILE_FAILURE/);
  assert.equal(fs.readFileSync(path.join(midFailure.fixtureRoot, 'components/first.bin'), 'utf8'), 'mid-failure-original-first.bin');
  assert.equal(fs.readFileSync(path.join(midFailure.fixtureRoot, 'components/second.bin'), 'utf8'), 'mid-failure-original-second.bin');
  assert.equal(JSON.parse(fs.readFileSync(midJournal, 'utf8').trim().split('\n').at(-1)).status, 'FAILED');

  const rollbackFailure = makeTwoFileRepairFixture('rollback-failure');
  const rollbackBackup = path.join(root, 'rollback-failure-backups');
  const rollbackJournal = path.join(root, 'rollback-failure.jsonl');
  assert.throws(() => repairComponents({ root: rollbackFailure.fixtureRoot, bundleRoot: rollbackFailure.fixtureBundle, backupRoot: rollbackBackup, journalFile: rollbackJournal, manifest: rollbackFailure.manifest, dryRun: false, testHooks: {
    beforeReplace: (_operation, index) => { if (index === 1) throw new Error('INJECTED_SECOND_FILE_FAILURE'); },
    beforeRollback: operation => { if (operation.path === 'components/first.bin') throw new Error('INJECTED_ROLLBACK_FAILURE'); },
  } }), /rollback is incomplete.*PARTIAL/i);
  const partialRecords = fs.readFileSync(rollbackJournal, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(partialRecords.at(-1).status, 'PARTIAL');
  assert.throws(() => repairComponents({ root: rollbackFailure.fixtureRoot, bundleRoot: rollbackFailure.fixtureBundle, backupRoot: rollbackBackup, journalFile: rollbackJournal, manifest: rollbackFailure.manifest, dryRun: false }), /STARTED or PARTIAL run requires verifyPartialRepairState/);
  assert.equal(verifyPartialRepairState({ root: rollbackFailure.fixtureRoot, journalFile: rollbackJournal }).verified, true);
  const resumed = repairComponents({ root: rollbackFailure.fixtureRoot, bundleRoot: rollbackFailure.fixtureBundle, backupRoot: rollbackBackup, journalFile: rollbackJournal, manifest: rollbackFailure.manifest, dryRun: false });
  assert.ok(resumed.after.every(item => item.status === 'PASS'));
  const manager = fs.readFileSync(new URL('./server-manager/server-manager.mjs', import.meta.url), 'utf8');
  const ingest = fs.readFileSync(new URL('../app/api/server-manager/events/route.ts', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const health = fs.readFileSync(new URL('../app/api/server-manager/health/route.ts', import.meta.url), 'utf8');
  const maintenance = fs.readFileSync(new URL('../app/api/server-manager/maintenance/route.ts', import.meta.url), 'utf8');
  const incidents = fs.readFileSync(new URL('../app/api/admin/server-incidents/route.ts', import.meta.url), 'utf8');
  const registryApi = fs.readFileSync(new URL('../app/api/admin/server-registry/route.ts', import.meta.url), 'utf8');
  assert.match(manager, /createTechnicalEventOutbox/);
  assert.match(manager, /process\.crashed/);
  assert.match(ingest, /isServerManagerRequest\(request\)/);
  assert.match(ingest, /gameServer\.findUnique/);
  assert.match(ingest, /serverIncident\.upsert/);
  assert.match(health, /gameProcessReady/);
  assert.match(health, /SERVER_NOT_REGISTERED/);
  assert.doesNotMatch(health, /SERVER_NAMES/);
  assert.doesNotMatch(maintenance, /MANAGED_SERVERS/);
  assert.match(incidents, /requirePermission\("system\.incidents\.manage"\)/);
  assert.match(incidents, /auditRequest\(/);
  assert.match(registryApi, /requirePermission\("servers\.manage"\)/);
  assert.match(schema, /model ServerTechnicalEvent/);
  assert.match(schema, /model ServerIncident/);
  console.log('Server infrastructure primitives: PASS (event outbox/redaction, dynamic registry, add planning, idle-vs-process health, manifest draft/hash validation, protected config paths, dry-run and backup restore fixtures, dual grenade DLL paths)');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
