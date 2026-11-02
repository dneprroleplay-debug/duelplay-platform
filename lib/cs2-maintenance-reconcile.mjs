export const REQUIRED_CS2_SERVERS = Object.freeze(['cs2-1', 'cs2-2', 'cs2-3']);
export const RECONCILE_MIN_FAILED_AGE_MS = 0;
export const RECONCILE_MIN_RUNNING_AGE_MS = 10 * 60_000;

function parseTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string' && typeof value !== 'number') return Number.NaN;
  return new Date(value).getTime();
}

/**
 * A scheduled updater run is allowed to leave maintenance enabled after a
 * post-mutation failure. It must not leave it enabled forever. Only terminal
 * FAILED state and an abandoned RUNNING state are eligible for automatic
 * reconciliation; SUCCEEDED/NO_UPDATE may have been set by an administrator.
 */
export function classifyStaleUpdaterState(updateStatus, {
  now = Date.now(),
  minFailedAgeMs = RECONCILE_MIN_FAILED_AGE_MS,
  minRunningAgeMs = RECONCILE_MIN_RUNNING_AGE_MS,
} = {}) {
  if (!updateStatus || typeof updateStatus !== 'object' || Array.isArray(updateStatus)) {
    return { stale: false, reason: 'UPDATE_STATUS_MISSING' };
  }
  const status = String(updateStatus.status ?? '');
  if (status !== 'FAILED' && status !== 'RUNNING') {
    return { stale: false, reason: `STATUS_${status || 'UNKNOWN'}_NOT_AUTO_RECOVERABLE` };
  }
  const startedAt = parseTime(updateStatus.startedAt);
  if (!Number.isFinite(startedAt)) return { stale: false, reason: 'STARTED_AT_UNKNOWN' };
  const ageMs = now - startedAt;
  if (ageMs < 0) return { stale: false, reason: 'STARTED_AT_IN_FUTURE' };
  const minAgeMs = status === 'FAILED' ? minFailedAgeMs : minRunningAgeMs;
  if (ageMs < minAgeMs) return { stale: false, reason: `${status}_RECENT` };
  return { stale: true, reason: status === 'FAILED' ? 'FAILED_UPDATE_LEFT_MAINTENANCE_ON' : 'ABANDONED_RUNNING_UPDATE' };
}

export function clusterIsIdleAndHealthy(snapshot, requiredServers = REQUIRED_CS2_SERVERS) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (snapshot.activeMatches !== 0) return false;
  if (!Array.isArray(snapshot.servers) || snapshot.servers.length !== requiredServers.length) return false;
  const names = snapshot.servers.map(server => server?.name);
  if (new Set(names).size !== requiredServers.length || requiredServers.some(name => !names.includes(name))) return false;
  return requiredServers.every(name => {
    const server = snapshot.servers.find(item => item?.name === name);
    return Boolean(server)
      && server.status === 'READY'
      && !server.matchId
      && (server.processId === null || server.processId === undefined)
      && server.managerReady === true
      && server.gameProcessReady === false
      && server.gameProcessStatus === 'STOPPED'
      && (server.gameProcessPid === null || server.gameProcessPid === undefined)
      && server.heartbeatFresh === true;
  });
}

export function decideStaleMaintenanceRelease(snapshot, {
  now = Date.now(),
  force = false,
  requiredServers = REQUIRED_CS2_SERVERS,
} = {}) {
  if (!snapshot || snapshot.maintenance !== true) {
    return { release: false, reason: 'MAINTENANCE_DISABLED' };
  }
  if (!clusterIsIdleAndHealthy(snapshot, requiredServers)) {
    return { release: false, reason: 'CLUSTER_NOT_IDLE_AND_HEALTHY' };
  }
  if (force) {
    return { release: true, reason: 'EXPLICIT_OPERATOR_RECONCILIATION' };
  }
  const classification = classifyStaleUpdaterState(snapshot.updateStatus, { now });
  return { release: classification.stale, reason: classification.reason };
}
