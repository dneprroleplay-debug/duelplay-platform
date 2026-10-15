import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function parseManagerEnvFile(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing per-server environment file: ${filePath}`);
  const values = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

export function loadInstanceRegistry(configDir) {
  const envFiles = readdirSync(configDir).filter(name => name === '.env' || /^\.env\.cs2-[1-9]\d*$/.test(name)).sort();
  const servers = envFiles.map(env => {
    const values = parseManagerEnvFile(join(configDir, env));
    const name = values.DUELPLAY_SERVER_ID || (env === '.env' ? 'cs2-1' : '');
    const port = Number(values.CS2_PORT);
    const managerPort = Number(values.DUELPLAY_MANAGER_PORT);
    const root = values.CS2_DIR;
    if (!/^cs2-[1-9]\d*$/.test(name) || !root || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(managerPort) || managerPort < 1 || managerPort > 65535) throw new Error(`Invalid server identity, CS2_DIR, CS2_PORT, or DUELPLAY_MANAGER_PORT in ${env}`);
    return { name, env, root, port, managerPort };
  });
  if (!servers.length) throw new Error('No per-server environment files were found.');
  for (const [label, values] of [
    ['DUELPLAY_SERVER_ID', servers.map(server => server.name)],
    ['CS2_PORT', servers.map(server => server.port)],
    ['DUELPLAY_MANAGER_PORT', servers.map(server => server.managerPort)],
    ['CS2_DIR', servers.map(server => server.root)],
  ]) if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} values in per-server environment files.`);
  return servers.sort((a, b) => Number(a.name.slice(4)) - Number(b.name.slice(4)));
}
