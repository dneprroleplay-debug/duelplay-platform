import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function compareComponentParity(servers, relativePaths) {
  return relativePaths.map(({ path, component }) => {
    const files = servers.map(server => {
      const file = join(server.root, path);
      return { server: server.name, file, hash: existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null };
    });
    const present = files.filter(file => file.hash !== null);
    const missing = files.filter(file => file.hash === null);
    const hashes = new Set(present.map(file => file.hash));
    return { component, path, status: missing.length ? 'MISSING' : hashes.size > 1 ? 'DRIFT' : 'PASS', files };
  });
}
