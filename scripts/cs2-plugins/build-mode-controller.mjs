import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAME_MODE_CONTROLLER_VERSION,
  REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES,
} from '../../lib/game-mode-config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = join(here, 'DuelPlayModeController');
const sourceFile = join(projectDir, 'DuelPlayModeController.cs');
const projectFile = join(projectDir, 'DuelPlayModeController.csproj');
const outputDir = join(projectDir, 'bin', 'Release', 'net10.0');
const bundleDir = join(outputDir, 'mode-controller-bundle');

const source = readFileSync(sourceFile, 'utf8');
if (!source.includes(`ControllerVersion = "${GAME_MODE_CONTROLLER_VERSION}"`)) {
  throw new Error(`Plugin source version does not match ${GAME_MODE_CONTROLLER_VERSION}`);
}
for (const capability of REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES) {
  if (!source.includes(`"${capability}"`)) throw new Error(`Plugin source is missing capability ${capability}`);
}

execFileSync('dotnet', ['build', projectFile, '--configuration', 'Release'], { stdio: 'inherit', cwd: here });

for (const file of ['DuelPlayModeController.dll', 'DuelPlayModeController.deps.json']) {
  if (!existsSync(join(outputDir, file))) throw new Error(`Build output is missing ${file}`);
}

rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });
for (const file of ['DuelPlayModeController.dll', 'DuelPlayModeController.deps.json']) {
  copyFileSync(join(outputDir, file), join(bundleDir, file));
}
const pdb = join(outputDir, 'DuelPlayModeController.pdb');
if (existsSync(pdb)) copyFileSync(pdb, join(bundleDir, 'DuelPlayModeController.pdb'));

const dll = readFileSync(join(bundleDir, 'DuelPlayModeController.dll'));
const manifest = {
  schemaVersion: 1,
  name: 'DuelPlayModeController',
  version: GAME_MODE_CONTROLLER_VERSION,
  sha256: createHash('sha256').update(dll).digest('hex'),
  capabilities: [...REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES],
  artifact: 'DuelPlayModeController.dll',
  targetFramework: 'net10.0',
  builtAt: new Date().toISOString(),
  source: 'scripts/cs2-plugins/DuelPlayModeController/DuelPlayModeController.cs',
};
writeFileSync(join(bundleDir, 'mode-controller.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(`Mode controller bundle ready: ${bundleDir}\n`);
process.stdout.write(`version=${manifest.version} sha256=${manifest.sha256}\n`);
