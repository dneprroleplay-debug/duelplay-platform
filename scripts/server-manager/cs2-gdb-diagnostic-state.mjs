import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function resolveStateFile(override) {
  if (override) return override;
  return process.env.DUELPLAY_CS2_DIAGNOSE_GDB_STATE_FILE || join(process.cwd(), '.cs2-diagnose-gdb-once');
}

export function isCs2GdbDiagnosticConsumed(override) {
  const stateFile = resolveStateFile(override);
  try { return readFileSync(stateFile, 'utf8').trim() === '1'; } catch { return false; }
}

export function markCs2GdbDiagnosticConsumed(override) {
  const stateFile = resolveStateFile(override);
  try { writeFileSync(stateFile, '1', { flag: 'w' }); return true; } catch { return false; }
}
