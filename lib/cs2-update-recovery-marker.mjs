import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  CS2_RECOVERY_MARKER_MAX_AGE_MS,
  isCs2RecoveryMarker,
  isLegacyCs2UpdaterMarkerContent,
} from './cs2-update-recovery.mjs';

function markerIdentity(marker) {
  return {
    dev: marker.dev,
    ino: marker.ino,
    mtimeMs: marker.mtimeMs,
    size: marker.size,
  };
}

export function sameMarkerIdentity(left, right) {
  return Boolean(left && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mtimeMs === right.mtimeMs
    && left.size === right.size);
}

function fsyncDirectory(directoryPath) {
  const fd = fs.openSync(directoryPath, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/**
 * Marker adapter for use only while the caller holds the shared flock-v1 lock.
 * The lock serializes every supported marker writer (update-all and controlled
 * recovery). Re-reading a pathname alone is not a TOCTOU defense.
 *
 * flock is advisory. This protects against participating processes on Linux local
 * filesystems with normal flock semantics (e.g. ext4/xfs), not an administrator or
 * unrelated process that ignores the lock and mutates the marker path directly.
 */
export function createMarkerAdapter(markerPath, {
  now = () => Date.now(),
  pidIsAlive = pid => {
    try { process.kill(pid, 0); return true; }
    catch (error) {
      if (error && typeof error === 'object' && error.code === 'ESRCH') return false;
      return true;
    }
  },
} = {}) {
  return {
    read() {
      let fd;
      try {
        fd = fs.openSync(markerPath, 'r');
        const stat = fs.fstatSync(fd);
        let content = null;
        try {
          const text = fs.readFileSync(fd, 'utf8');
          content = JSON.parse(text);
        } catch {}
        return {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          ino: stat.ino,
          dev: stat.dev,
          content,
        };
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
        throw error;
      } finally {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch {}
        }
      }
    },

    writeRecoveryMarker(content, expectedMarker) {
      const current = this.read();
      const recoveryId = content?.recoveryId;
      const ownershipToken = content?.ownershipToken;

      if (current && isCs2RecoveryMarker(current, recoveryId, ownershipToken) && expectedMarker === null) {
        return current;
      }

      if (expectedMarker === null) {
        if (current) throw new Error('SYNC_MARKER_CHANGED_BEFORE_REFRESH');
      } else {
        if (!sameMarkerIdentity(current, expectedMarker)) {
          throw new Error('SYNC_MARKER_CHANGED_BEFORE_REFRESH');
        }
        if (isCs2RecoveryMarker(current, recoveryId, ownershipToken)) {
          // Refreshing an existing marker is allowed only for this recovery ID.
        } else {
          const legacyOriginal = isLegacyCs2UpdaterMarkerContent(current?.content);
          const stale = current && Number.isFinite(current.mtimeMs)
            && now() - current.mtimeMs >= CS2_RECOVERY_MARKER_MAX_AGE_MS;
          if (!legacyOriginal || !stale || pidIsAlive(current.content.pid)) {
            throw new Error('SYNC_MARKER_OWNERSHIP_MISMATCH');
          }
        }
      }

      const tempPath = `${markerPath}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`;
      let fd;
      try {
        fd = fs.openSync(tempPath, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify(content));
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;

        // The shared flock makes the expected-path decision stable against all
        // supported marker writers. For absent paths, link() supplies kernel-level
        // no-replace semantics and fails with EEXIST rather than overwriting a file.
        const latest = this.read();
        if (expectedMarker === null) {
          if (latest) throw new Error('SYNC_MARKER_CHANGED_BEFORE_REFRESH');
          fs.linkSync(tempPath, markerPath);
          fs.unlinkSync(tempPath);
        } else {
          if (!sameMarkerIdentity(latest, expectedMarker)) {
            throw new Error('SYNC_MARKER_CHANGED_BEFORE_REFRESH');
          }
          fs.renameSync(tempPath, markerPath);
        }
        fsyncDirectory(path.dirname(markerPath));
        return this.read();
      } catch (error) {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch {}
        }
        try { fs.unlinkSync(tempPath); } catch {}
        throw error;
      }
    },

    removeOwnedRecoveryMarker(recoveryId, ownershipToken, expectedIdentity) {
      const current = this.read();
      if (!current) return null;
      if (!isCs2RecoveryMarker(current, recoveryId, ownershipToken)) {
        throw new Error('SYNC_MARKER_OWNERSHIP_MISMATCH');
      }
      if (expectedIdentity && !sameMarkerIdentity(current, expectedIdentity)) {
        throw new Error('SYNC_MARKER_OWNERSHIP_MISMATCH');
      }

      // This unlink is safe against the supported competing writers because both
      // updater and recovery hold the same kernel flock for their full lifetime.
      fs.unlinkSync(markerPath);
      fsyncDirectory(path.dirname(markerPath));
      return {
        marker: markerIdentity(current),
        disposition: 'UNLINKED',
        observedAt: new Date(now()).toISOString(),
      };
    },
  };
}
