import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CS2_FLOCK_CHILD_FLAG = '--duelplay-internal-flock-child';
export const CS2_FLOCK_TOKEN_ENV = 'DUELPLAY_CS2_INTERNAL_FLOCK_TOKEN';
export const CS2_FLOCK_CONFLICT_EXIT = 75;

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ESRCH') return false;
    // EPERM means a process exists but cannot be signalled by this account.
    return true;
  }
}


function linuxDeviceNumber(dev) {
  const value = BigInt(dev);
  const major = ((value >> 8n) & 0xfffn) | ((value >> 32n) & 0xfffff000n);
  const minor = (value & 0xffn) | ((value >> 12n) & 0xffffff00n);
  return `${major.toString(16).padStart(2, '0')}:${minor.toString(16).padStart(2, '0')}`;
}

function assertKernelFlockOwnedByCurrentProcess(lockPath) {
  // -F/--no-fork causes flock to exec Node without changing PID. Verify the kernel
  // lock is registered to this PID and that an inherited descriptor references the
  // same inode. An env flag alone is not proof of lock ownership.
  const stat = fs.statSync(lockPath);
  const targetDevice = linuxDeviceNumber(stat.dev);
  const descriptors = fs.readdirSync('/proc/self/fd');
  const inheritedDescriptor = descriptors.find(descriptor => {
    if (!/^\d+$/.test(descriptor)) return false;
    try {
      const descriptorStat = fs.statSync(`/proc/self/fd/${descriptor}`);
      return descriptorStat.dev === stat.dev && descriptorStat.ino === stat.ino;
    } catch { return false; }
  });
  if (!inheritedDescriptor) throw new Error('CS2_CONTROL_LOCK_DESCRIPTOR_MISSING');

  const lockLines = fs.readFileSync('/proc/locks', 'utf8').split(/\r?\n/);
  const ownsKernelLock = lockLines.some(line => {
    const parts = line.trim().split(/\s+/);
    if (parts[1] !== 'FLOCK' || parts[3] !== 'WRITE' || parts[4] !== String(process.pid)) return false;
    const devInode = parts[5]?.split(':');
    return devInode?.length === 3
      && `${devInode[0]}:${devInode[1]}`.toLowerCase() === targetDevice.toLowerCase()
      && devInode[2] === String(stat.ino);
  });
  if (!ownsKernelLock) throw new Error('CS2_CONTROL_KERNEL_FLOCK_NOT_OWNED_BY_PROCESS');
  return { dev: stat.dev, ino: stat.ino };
}

function readLockMetadataFromDescriptor(fd) {
  const text = fs.readFileSync(fd, 'utf8');
  if (!text.trim()) return null;
  try { return JSON.parse(text); }
  catch { throw new Error('CS2_CONTROL_LOCK_METADATA_UNREADABLE; refusing to alter an unverifiable lock file'); }
}

function writeLockMetadataInPlace(lockPath, ownerToken, expectedLock) {
  // Open the pathname once, then read/write through that descriptor. Verify its
  // inode against the descriptor inherited from flock; never mutate a replacement
  // inode that appeared after the kernel lock was acquired.
  const fd = fs.openSync(lockPath, 'r+');
  try {
    const descriptorStat = fs.fstatSync(fd);
    if (descriptorStat.dev !== expectedLock.dev || descriptorStat.ino !== expectedLock.ino) {
      throw new Error('CS2_CONTROL_LOCK_PATH_CHANGED_AFTER_ACQUIRE');
    }
    const pathStat = fs.statSync(lockPath);
    if (pathStat.dev !== expectedLock.dev || pathStat.ino !== expectedLock.ino) {
      throw new Error('CS2_CONTROL_LOCK_PATH_CHANGED_AFTER_ACQUIRE');
    }

    const previous = readLockMetadataFromDescriptor(fd);
    if (previous) {
      const hasLegacyShape = Number.isSafeInteger(previous.pid) && previous.pid > 0
        && typeof previous.ownerToken === 'string' && previous.ownerToken.length > 0;
      if (previous.protocol !== 'flock-v1') {
        if (!hasLegacyShape) {
          throw new Error('CS2_CONTROL_LOCK_METADATA_UNRECOGNIZED; refusing to replace unverifiable lock metadata');
        }
        if (pidIsAlive(previous.pid)) {
          throw new Error(`CS2_LEGACY_RECOVERY_LOCK_OWNER_ACTIVE pid=${previous.pid}`);
        }
      }
      // A previous flock-v1 owner can be stale if this invocation acquired the
      // kernel lock. The kernel lock, not this diagnostic JSON, is authoritative.
    }

    const latestPathStat = fs.statSync(lockPath);
    if (latestPathStat.dev !== descriptorStat.dev || latestPathStat.ino !== descriptorStat.ino) {
      throw new Error('CS2_CONTROL_LOCK_PATH_CHANGED_BEFORE_METADATA_WRITE');
    }
    const metadata = JSON.stringify({
      protocol: 'flock-v1',
      pid: process.pid,
      ownerToken,
      startedAt: new Date().toISOString(),
    });
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, metadata, 0, 'utf8');
    fs.fsyncSync(fd);

    const finalPathStat = fs.statSync(lockPath);
    const finalDescriptorStat = fs.fstatSync(fd);
    if (finalPathStat.dev !== finalDescriptorStat.dev || finalPathStat.ino !== finalDescriptorStat.ino
      || finalPathStat.dev !== expectedLock.dev || finalPathStat.ino !== expectedLock.ino) {
      throw new Error('CS2_CONTROL_LOCK_PATH_CHANGED_DURING_METADATA_WRITE');
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Serialize a whole executable lifetime using Linux util-linux flock.
 * The lock file is stable and deliberately never unlinked: flock locks an inode,
 * so unlinking/recreating the path could let two processes lock different inodes.
 *
 * Call this at module top-level, before side effects. Both the controlled recovery
 * executable and update-all.mjs must use the same lock path.
 *
 * @returns {{isChild: true, args: string[]} | {isChild: false, exitCode: number, error?: string}}
 */
export function enterFlockOrRelaunch({
  lockPath,
  scriptPath = process.argv[1],
  argv = process.argv.slice(2),
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  if (typeof lockPath !== 'string' || !lockPath || typeof scriptPath !== 'string' || !scriptPath) {
    throw new Error('CS2_CONTROL_LOCK_CONFIGURATION_INVALID');
  }

  const token = argv[1];
  const isFlockChild = argv[0] === CS2_FLOCK_CHILD_FLAG
    && typeof token === 'string'
    && token.length >= 32
    && env[CS2_FLOCK_TOKEN_ENV] === token;

  if (isFlockChild) {
    const lockIdentity = assertKernelFlockOwnedByCurrentProcess(lockPath);
    writeLockMetadataInPlace(lockPath, token, lockIdentity);
    // Do not propagate the internal one-time token to updater subprocesses.
    if (env === process.env) delete process.env[CS2_FLOCK_TOKEN_ENV];
    return { isChild: true, args: argv.slice(2) };
  }

  // Create the stable inode atomically if this is the first user. Never unlink it.
  const fd = fs.openSync(lockPath, 'a', 0o600);
  try { fs.fchmodSync(fd, 0o600); } finally { fs.closeSync(fd); }

  const childToken = randomBytes(24).toString('hex');
  let result;
  try {
    result = spawnSyncImpl('flock', [
      '-n', '-F', '-E', String(CS2_FLOCK_CONFLICT_EXIT), path.resolve(lockPath),
      process.execPath, path.resolve(scriptPath), CS2_FLOCK_CHILD_FLAG, childToken, ...argv,
    ], {
      env: { ...env, [CS2_FLOCK_TOKEN_ENV]: childToken },
      stdio: 'inherit',
    });
  } catch (error) {
    return { isChild: false, exitCode: 1, error: `CS2_FLOCK_EXEC_FAILED: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (result.error) {
    return { isChild: false, exitCode: 1, error: `CS2_FLOCK_EXEC_FAILED: ${result.error.message}` };
  }
  if (result.status === CS2_FLOCK_CONFLICT_EXIT) {
    return { isChild: false, exitCode: CS2_FLOCK_CONFLICT_EXIT, error: 'CS2_CONTROL_OPERATION_ALREADY_RUNNING' };
  }
  if (result.status === null) {
    return { isChild: false, exitCode: 1, error: `CS2_FLOCK_CHILD_DID_NOT_EXIT: signal=${result.signal ?? 'unknown'}` };
  }
  return { isChild: false, exitCode: result.status };
}
