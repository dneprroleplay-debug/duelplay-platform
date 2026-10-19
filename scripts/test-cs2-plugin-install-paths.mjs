import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(path, 'utf8');
const manifest = JSON.parse(read('scripts/server-manager/component-bundle/manifest.json'));
const updateAll = read('scripts/server-manager/update-all.mjs');
const registry = read('scripts/server-manager/instance-registry.mjs');
const readme = read('scripts/cs2-plugins/DuelPlayGrenadeOnly/README.md');
const envExample = read('scripts/server-manager/.env.example');
const deployment = read('DEPLOYMENT_VPS.md');

// CounterStrikeSharp resolves plugins relative to each instance root, so the
// canonical DLL lives under <CS2_DIR>/csgo/addons/... and the shared game tree
// (used only by SteamCMD) is never read by a running server.
const canonicalGrenade = 'csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.dll';
const legacyRootDup = 'csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly.dll';
const perInstanceDir = '/home/ubuntu/cs2/instances/cs2-1/root';
const sharedGameDir = '/home/ubuntu/cs2/game';

const checks = [
  ['manifest tracks the canonical CounterStrikeSharp plugin path', manifest.components.some((item) => item.path === canonicalGrenade)],
  ['manifest never tracks the legacy root-level plugin DLL', !manifest.components.some((item) => item.path === legacyRootDup)],
  ['every manifest component is a relative csgo/addons path', manifest.components.every((item) => item.path.startsWith('csgo/addons/') && !item.path.startsWith('/') && !item.path.includes('..'))],
  ['components are inspected under the per-instance CS2_DIR root', updateAll.includes('inspectComponentRoot(server.root, manifest)')],
  ['post-startup plugin checks resolve paths under the instance root', updateAll.includes('existsSync(join(server.root, path))')],
  ['per-instance root comes from each manager env file', registry.includes('const root = values.CS2_DIR;')],
  ['plugin README documents the per-instance install directory', readme.includes('$CS2_DIR/csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly/')],
  ['plugin README drops the shared game-tree install path', !readme.includes('<server>/game/csgo/addons')],
  ['env example points CS2_DIR at an instance root', envExample.includes(`CS2_DIR=${perInstanceDir}`)],
  ['env example does not point CS2_DIR at the shared game tree', !envExample.includes(`CS2_DIR=${sharedGameDir}`)],
  ['deployment guide points CS2_DIR at an instance root', deployment.includes(`CS2_DIR=${perInstanceDir}`)],
  ['deployment guide no longer points CS2_DIR at the shared game tree', !deployment.includes(`CS2_DIR=${sharedGameDir}`)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}
assert.equal(failed, 0, `${failed} plugin install-path check(s) failed`);
console.log(`\nGRENADE_ONLY per-instance install-path regression: PASS (${checks.length} checks)`);
