import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const HASH_RE = /^[a-f0-9]{64}$/i;

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function safeChild(base, path, label) {
  if (!path || isAbsolute(path)) throw new Error(`${label} path must be relative.`);
  const basePath = resolve(base);
  const target = resolve(basePath, path);
  const rel = relative(basePath, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} path escapes its root.`);
  if (existsSync(basePath)) {
    const realBase = realpathSync(basePath);
    let existing = target;
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    const realExisting = realpathSync(existing);
    const realRelative = relative(realBase, realExisting);
    if (realRelative === '..' || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
      throw new Error(`${label} path traverses outside its root through a symbolic link.`);
    }
  }
  return target;
}

export function validateComponentManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.bundleVersion !== 'string' || !Array.isArray(manifest.components)) {
    throw new Error('Invalid component manifest schema.');
  }
  const paths = new Set();
  for (const item of manifest.components) {
    if (!item || typeof item.name !== 'string' || typeof item.path !== 'string') throw new Error('Each component needs a name and relative path.');
    if (item.path === 'csgo/gameinfo.gi' || item.path.startsWith('csgo/cfg/') || item.path.startsWith('csgo/addons/counterstrikesharp/configs/')) {
      throw new Error(`Instance-specific configuration cannot be in the shared component manifest: ${item.path}`);
    }
    safeChild('manifest-root', item.path, 'Component');
    if (paths.has(item.path)) throw new Error(`Duplicate manifest path: ${item.path}`);
    paths.add(item.path);
    if (item.sha256 !== null && item.sha256 !== undefined && !HASH_RE.test(item.sha256)) throw new Error(`Invalid SHA-256 for ${item.path}.`);
    if (item.version !== null && item.version !== undefined && typeof item.version !== 'string') throw new Error(`Invalid version for ${item.path}.`);
  }
  return manifest;
}

export function buildComponentManifest({ bundleRoot, bundleVersion, sourceDescription, components }) {
  if (!bundleVersion || !sourceDescription || !Array.isArray(components) || components.length === 0) throw new Error('Bundle version, source description, and component list are required.');
  const built = components.map(item => {
    const artifact = safeChild(bundleRoot, item.artifact, 'Artifact');
    if (!existsSync(artifact)) throw new Error(`Bundle artifact is missing: ${item.artifact}`);
    return { ...item, sha256: sha256(artifact), version: item.version ?? null };
  });
  return validateComponentManifest({ schemaVersion: 1, bundleVersion, approval: 'UNVERIFIED', gameBuild: null, compatibility: 'UNKNOWN', provenance: sourceDescription, components: built, instanceSpecificPaths: ['csgo/gameinfo.gi', 'csgo/cfg/**', 'csgo/addons/counterstrikesharp/configs/**'] });
}

export function inspectComponentRoot(root, manifest) {
  validateComponentManifest(manifest);
  return manifest.components.map(item => {
    try {
      const file = safeChild(root, item.path, 'Component');
      if (!existsSync(file)) return { name: item.name, path: item.path, status: item.sha256 ? 'MISSING' : 'UNKNOWN', expectedHash: item.sha256 ?? null, actualHash: null };
      const actualHash = sha256(file);
      if (!item.sha256) return { name: item.name, path: item.path, status: 'UNKNOWN', expectedHash: null, actualHash };
      return { name: item.name, path: item.path, status: actualHash === item.sha256.toLowerCase() ? 'PASS' : 'DRIFT', expectedHash: item.sha256.toLowerCase(), actualHash };
    } catch (error) {
      return { name: item.name, path: item.path, status: 'FAILED', error: error.message, expectedHash: item.sha256 ?? null, actualHash: null };
    }
  });
}

export function createRepairPlan(root, bundleRoot, manifest, inspection = inspectComponentRoot(root, manifest)) {
  validateComponentManifest(manifest);
  if (manifest.approval !== 'APPROVED') throw new Error('Repair is blocked: component manifest is not approved.');
  const plan = [];
  for (const result of inspection) {
    if (result.status === 'PASS') continue;
    if (!['MISSING', 'DRIFT'].includes(result.status)) throw new Error(`Repair is blocked for ${result.path}: status ${result.status}.`);
    const item = manifest.components.find(component => component.path === result.path);
    if (!item?.sha256 || !item.artifact) throw new Error(`Repair is blocked for ${result.path}: approved hash or artifact is missing.`);
    const artifact = safeChild(bundleRoot, item.artifact, 'Artifact');
    if (!existsSync(artifact) || sha256(artifact) !== item.sha256.toLowerCase()) throw new Error(`Repair artifact failed SHA-256 validation: ${item.artifact}`);
    plan.push({ name: item.name, path: item.path, status: result.status, artifact: item.artifact, sha256: item.sha256.toLowerCase(), originalHash: result.actualHash, existedBefore: result.status !== 'MISSING' });
  }
  return plan;
}

function readRepairJournal(journalFile) {
  if (!existsSync(journalFile)) return [];
  return readFileSync(journalFile, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Repair journal is invalid at line ${index + 1}; refusing to continue.`); }
  });
}

function unreviewedRepairStates(records, rootPath) {
  const reviewed = new Set(records.filter(row => row.status === 'STATE_VERIFIED' && row.root === rootPath).map(row => row.runId));
  const finished = new Set(records.filter(row => ['SUCCEEDED', 'FAILED', 'PARTIAL'].includes(row.status) && row.root === rootPath).map(row => row.runId));
  const interrupted = records.filter(row => row.status === 'STARTED' && row.root === rootPath && !finished.has(row.runId));
  const partial = records.filter(row => row.status === 'PARTIAL' && row.root === rootPath && !reviewed.has(row.runId));
  return [...interrupted, ...partial];
}

export function verifyPartialRepairState({ root, journalFile }) {
  const rootPath = realpathSync(root);
  const records = readRepairJournal(journalFile);
  const pending = unreviewedRepairStates(records, rootPath);
  if (!pending.length) return { verified: true, reviewedRuns: [] };
  const reviewedRuns = [];
  const states = [];
  for (const interrupted of pending) {
    if (!Array.isArray(interrupted.plan)) throw new Error(`Repair journal has no plan for run ${interrupted.runId}; recovery remains blocked.`);
    for (const operation of interrupted.plan) {
      const target = safeChild(root, operation.path, 'Target');
      const present = existsSync(target);
      const actualHash = present ? sha256(target) : null;
      const knownState = operation.existedBefore
        ? actualHash === operation.originalHash || actualHash === operation.sha256
        : actualHash === null || actualHash === operation.sha256;
      if (!knownState) throw new Error(`Partial repair state is unverified at ${operation.path}; recovery remains blocked.`);
      if (operation.existedBefore && actualHash !== operation.originalHash) {
        const backup = safeChild(interrupted.backupRoot, operation.backupRelative, 'Backup');
        if (!existsSync(backup) || sha256(backup) !== operation.originalHash) throw new Error(`Partial repair backup is missing or invalid at ${operation.path}; recovery remains blocked.`);
      }
      states.push({ path: operation.path, actualHash, verified: true });
    }
    reviewedRuns.push(interrupted.runId);
  }
  const appendJournal = record => appendFileSync(journalFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  for (const runId of reviewedRuns) appendJournal({ runId, root: rootPath, time: new Date().toISOString(), status: 'STATE_VERIFIED', states });
  return { verified: true, reviewedRuns, states };
}

export function repairComponents({ root, bundleRoot, backupRoot, journalFile, manifest, dryRun = true, now = new Date(), testHooks = {} }) {
  const before = inspectComponentRoot(root, manifest);
  const plan = createRepairPlan(root, bundleRoot, manifest, before);
  if (dryRun || plan.length === 0) return { dryRun, plan, results: [], before };
  if (!backupRoot || !journalFile) throw new Error('Repair requires explicit backup and journal paths.');
  const rootPath = realpathSync(root);
  if (unreviewedRepairStates(readRepairJournal(journalFile), rootPath).length) throw new Error('Repair is blocked: a STARTED or PARTIAL run requires verifyPartialRepairState before another restore.');
  const runId = `${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const results = [];
  const attempted = [];
  const resolvedBackupRoot = resolve(backupRoot);
  mkdirSync(dirname(resolve(journalFile)), { recursive: true });
  const appendJournal = record => appendFileSync(journalFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  const journalPlan = plan.map(operation => ({ ...operation, backupRelative: `${runId}/${operation.path}` }));
  appendJournal({ runId, root: rootPath, backupRoot: resolvedBackupRoot, bundleVersion: manifest.bundleVersion, time: now.toISOString(), status: 'STARTED', plan: journalPlan });
  try {
    for (let index = 0; index < plan.length; index += 1) {
      const operation = plan[index];
      const target = safeChild(root, operation.path, 'Target');
      const artifact = safeChild(bundleRoot, operation.artifact, 'Artifact');
      const backupRelative = `${runId}/${operation.path}`;
      const backup = safeChild(resolvedBackupRoot, backupRelative, 'Backup');
      const existedBefore = existsSync(target);
      const currentHash = existedBefore ? sha256(target) : null;
      if (existedBefore !== operation.existedBefore || currentHash !== operation.originalHash) throw new Error(`Component changed after planning: ${operation.path}`);
      mkdirSync(dirname(target), { recursive: true });
      if (existedBefore) {
        mkdirSync(dirname(backup), { recursive: true });
        const safeBackup = safeChild(resolvedBackupRoot, backupRelative, 'Backup');
        copyFileSync(target, safeBackup, constants.COPYFILE_EXCL);
        if (sha256(safeBackup) !== operation.originalHash) throw new Error(`Backup SHA-256 validation failed: ${operation.path}`);
      }
      attempted.push({ ...operation, backupRelative, backupRoot: resolvedBackupRoot });
      testHooks.beforeReplace?.(operation, index);
      const temporary = `${target}.repair-${runId}`;
      let staged = false;
      try {
        copyFileSync(artifact, temporary, constants.COPYFILE_EXCL);
        staged = true;
        if (sha256(temporary) !== operation.sha256) throw new Error(`Staged repair file failed SHA-256 validation: ${operation.path}`);
        renameSync(temporary, target);
        staged = false;
      } finally {
        if (staged && existsSync(temporary)) unlinkSync(temporary);
      }
      if (sha256(target) !== operation.sha256) throw new Error(`Post-repair SHA-256 failed: ${operation.path}`);
      results.push({ ...operation, backup: existedBefore ? backup : null, status: 'RESTORED' });
    }
    const after = inspectComponentRoot(root, manifest);
    if (after.some(item => item.status !== 'PASS')) throw new Error('Post-repair verification failed. See repair journal and backups.');
    appendJournal({ runId, root: rootPath, bundleVersion: manifest.bundleVersion, time: new Date().toISOString(), status: 'SUCCEEDED', results });
    return { dryRun: false, plan, results, before, after };
  } catch (error) {
    const rollbackErrors = [];
    for (let index = attempted.length - 1; index >= 0; index -= 1) {
      const operation = attempted[index];
      try {
        testHooks.beforeRollback?.(operation, index);
        const target = safeChild(root, operation.path, 'Target');
        if (operation.existedBefore) {
          const backup = safeChild(operation.backupRoot, operation.backupRelative, 'Backup');
          if (!existsSync(backup) || sha256(backup) !== operation.originalHash) throw new Error(`Verified backup unavailable: ${operation.path}`);
          const temporary = `${target}.rollback-${runId}`;
          let staged = false;
          try {
            copyFileSync(backup, temporary, constants.COPYFILE_EXCL);
            staged = true;
            if (sha256(temporary) !== operation.originalHash) throw new Error(`Rollback staging hash mismatch: ${operation.path}`);
            renameSync(temporary, target);
            staged = false;
          } finally {
            if (staged && existsSync(temporary)) unlinkSync(temporary);
          }
          if (sha256(target) !== operation.originalHash) throw new Error(`Rollback verification failed: ${operation.path}`);
        } else if (existsSync(target)) {
          if (sha256(target) !== operation.sha256) throw new Error(`Unexpected file blocks rollback: ${operation.path}`);
          unlinkSync(target);
        }
      } catch (rollbackError) {
        rollbackErrors.push({ path: operation.path, error: rollbackError.message });
      }
    }
    const status = rollbackErrors.length ? 'PARTIAL' : 'FAILED';
    appendJournal({ runId, root: rootPath, backupRoot: resolvedBackupRoot, bundleVersion: manifest.bundleVersion, time: new Date().toISOString(), status, plan: journalPlan, rollback: rollbackErrors.length ? 'FAILED' : 'SUCCEEDED', rollbackErrors, error: error.message, results });
    if (rollbackErrors.length) throw new Error(`Repair failed and rollback is incomplete; journal status PARTIAL. Verify state before retrying: ${rollbackErrors.map(item => `${item.path}: ${item.error}`).join('; ')}`);
    throw error;
  }
}

export function writeManifest(file, manifest) {
  validateComponentManifest(manifest);
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
}
