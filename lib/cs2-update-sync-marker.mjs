import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

function ownershipError() {
  const error = new Error('SYNC_MARKER_OWNERSHIP_MISMATCH');
  error.code = 'SYNC_MARKER_OWNERSHIP_MISMATCH';
  return error;
}

function fileIdentity(stats) {
  return {
    dev: stats.dev,
    ino: stats.ino,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

function sameInode(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino);
}

function sameIdentity(left, right) {
  return Boolean(sameInode(left, right)
    && left.mtimeMs === right.mtimeMs
    && left.size === right.size);
}

function isNotFound(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'ENOENT');
}

function fsyncDirectory(directoryPath) {
  // The updater is deployed on Linux. Directory fsync is not exposed the same
  // way on Windows, so local Windows ownership tests skip only this durability
  // operation while exercising the same create/verify/cleanup logic.
  if (process.platform === 'win32') return;
  const fd = openSync(directoryPath, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readMarkerAtPath(markerPath) {
  let pathStats;
  try {
    pathStats = lstatSync(markerPath);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  // Do not follow a symlink or accept a non-regular marker file.
  if (!pathStats.isFile() || pathStats.isSymbolicLink()) throw ownershipError();

  let fd;
  try {
    fd = openSync(markerPath, 'r');
    const beforeRead = fstatSync(fd);
    if (!beforeRead.isFile() || !sameIdentity(fileIdentity(pathStats), fileIdentity(beforeRead))) {
      throw ownershipError();
    }

    const content = readFileSync(fd, 'utf8');
    const afterRead = fstatSync(fd);
    let pathAfterRead;
    try {
      pathAfterRead = lstatSync(markerPath);
    } catch {
      throw ownershipError();
    }

    const afterIdentity = fileIdentity(afterRead);
    if (!sameIdentity(fileIdentity(beforeRead), afterIdentity)
      || !sameIdentity(afterIdentity, fileIdentity(pathAfterRead))) {
      throw ownershipError();
    }
    return { identity: afterIdentity, content };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function matchesOwnedMarker(current, owned) {
  return Boolean(current && owned
    && sameIdentity(current.identity, owned.identity)
    && current.content === owned.content);
}

/**
 * Controls the legacy updater marker while the caller holds the shared flock.
 * The on-disk payload intentionally remains exactly { pid, startedAt } so the
 * controlled recovery state machine can continue recognizing legacy markers.
 */
export function createUpdaterSyncMarkerController(markerPath, {
  pid = process.pid,
  now = () => new Date(),
} = {}) {
  let owned = null;

  function assertOwned() {
    const current = readMarkerAtPath(markerPath);
    if (!matchesOwnedMarker(current, owned)) throw ownershipError();
    return current;
  }

  function begin() {
    const current = readMarkerAtPath(markerPath);
    if (current) {
      if (matchesOwnedMarker(current, owned)) return 'ALREADY_OWNED';
      // In particular, do not adopt or rewrite a stale legacy marker. Only the
      // process that successfully created this inode can claim it as its own.
      throw ownershipError();
    }

    // If our previous marker disappeared, that old inode no longer grants us
    // ownership of a future path at the same name. A new marker must be created
    // exclusively and tracked as a new inode.
    owned = null;

    const startedAt = now().toISOString();
    const content = JSON.stringify({ pid, startedAt });
    const tempPath = `${markerPath}.${pid}.${randomBytes(12).toString('hex')}.tmp`;
    let fd;
    let tempCreated = false;
    let tempIdentity = null;
    let linkedMarker = false;
    try {
      // Write and fsync a private temporary inode first. linkSync publishes it
      // atomically without replacing an existing marker, so readers never see a
      // partially written marker at the public path.
      fd = openSync(tempPath, 'wx', 0o600);
      tempCreated = true;
      writeFileSync(fd, content, 'utf8');
      fsyncSync(fd);
      tempIdentity = fileIdentity(fstatSync(fd));
      closeSync(fd);
      fd = undefined;

      linkSync(tempPath, markerPath);
      linkedMarker = true;
      const createdMarker = readMarkerAtPath(markerPath);
      if (!createdMarker
        || !sameInode(createdMarker.identity, tempIdentity)
        || createdMarker.content !== content) {
        throw ownershipError();
      }
      owned = { identity: createdMarker.identity, content };
      unlinkSync(tempPath);
      tempCreated = false;
      fsyncDirectory(dirname(markerPath));
      return 'CREATED';
    } catch (error) {
      if (fd !== undefined) {
        try { closeSync(fd); } catch {}
      }
      // If publication succeeded but a later check failed, claim ownership only
      // when both the exact content and the inode we created can still be proved.
      // Never delete the public marker in this error path: it may now be a
      // foreign replacement, and once published it must remain fail-closed.
      if (linkedMarker && !owned && tempIdentity) {
        try {
          const currentMarker = readMarkerAtPath(markerPath);
          if (currentMarker
            && sameInode(currentMarker.identity, tempIdentity)
            && currentMarker.content === content) {
            owned = { identity: currentMarker.identity, content };
          }
        } catch {
          // Unknown ownership means leave the public marker untouched.
        }
      }
      if (tempCreated) {
        try { unlinkSync(tempPath); } catch {}
      }
      if (error && typeof error === 'object' && error.code === 'EEXIST') throw ownershipError();
      throw error;
    }
  }

  function clear() {
    const current = readMarkerAtPath(markerPath);
    if (!current) {
      // Absence is a no-op only if this controller never owned a marker. If it
      // previously did, unexpected disappearance is an ownership/safety error.
      if (owned) throw ownershipError();
      return 'ABSENT';
    }

    if (!matchesOwnedMarker(current, owned)) throw ownershipError();

    // Re-read immediately before unlink. The shared flock serializes supported
    // writers; inode + exact payload checks prevent deleting a replaced marker.
    const latest = assertOwned();
    if (!sameIdentity(latest.identity, current.identity) || latest.content !== current.content) {
      throw ownershipError();
    }
    unlinkSync(markerPath);
    owned = null;
    fsyncDirectory(dirname(markerPath));
    return 'REMOVED';
  }

  return Object.freeze({ begin, clear, assertOwned });
}
