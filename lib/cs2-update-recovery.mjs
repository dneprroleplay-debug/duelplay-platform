export const REQUIRED_CS2_RECOVERY_SERVERS = Object.freeze(['cs2-1', 'cs2-2', 'cs2-3']);
export const CS2_RECOVERY_MARKER_MAX_AGE_MS = 4 * 60 * 60 * 1000;
export const CS2_RECOVERY_PHASES = Object.freeze([
  'PREPARED',
  'MARKER_REFRESHED',
  'STATUS_UPDATED',
  'COMPLETED',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateCs2RecoveryRunId(runId) {
  if (typeof runId !== 'string' || !UUID_PATTERN.test(runId)) {
    throw new Error('INVALID_RECOVERY_RUN_ID');
  }
  return runId.toLowerCase();
}

export function cs2RecoveryIdForRun(runId) {
  return `cs2-update-recovery-v1:${validateCs2RecoveryRunId(runId)}`;
}

export function cs2RecoverySettingKey(runId) {
  return `CS2_UPDATE_RECOVERY_V1_${validateCs2RecoveryRunId(runId)}`;
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length
    && expectedKeys.slice().sort().every((key, index) => key === keys[index]);
}

export function isLegacyCs2UpdaterMarkerContent(content) {
  // The pre-recovery update-all.mjs marker format is exactly { pid, startedAt }.
  // Unknown source/type fields, recoveryId fields, and extra keys are not trusted.
  return hasExactKeys(content, ['pid', 'startedAt'])
    && Number.isSafeInteger(content.pid) && content.pid > 0
    && typeof content.startedAt === 'string'
    && Number.isFinite(Date.parse(content.startedAt));
}

export function isCs2RecoveryMarker(marker, recoveryId, ownershipToken) {
  const content = marker?.content;
  return Boolean(typeof ownershipToken === 'string' && /^[0-9a-f]{64}$/.test(ownershipToken)
    && hasExactKeys(content, ['pid', 'startedAt', 'source', 'recoveryId', 'ownershipToken'])
    && content.source === 'duelplay-controlled-recovery'
    && content.recoveryId === recoveryId
    && content.ownershipToken === ownershipToken
    && Number.isSafeInteger(content.pid) && content.pid > 0
    && typeof content.startedAt === 'string'
    && Number.isFinite(Date.parse(content.startedAt)));
}

export function isCs2MarkerStale(marker, nowMs = Date.now()) {
  if (!marker || !Number.isFinite(marker.mtimeMs)) return false;
  const ageMs = nowMs - marker.mtimeMs;
  return ageMs >= CS2_RECOVERY_MARKER_MAX_AGE_MS;
}

function fail(code, detail = '') {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

function markerMatchesLedger(marker, ledger) {
  return Boolean(marker && ledger
    && marker.dev === ledger.markerDev
    && marker.ino === ledger.markerIno
    && marker.mtimeMs === ledger.markerMtimeMs
    && marker.size === ledger.markerSize);
}

function parseTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string' && typeof value !== 'number') return Number.NaN;
  return new Date(value).getTime();
}

/**
 * @param {any} snapshot
 * @param {{ nowMs?: number, phase?: string | null, recoveryId?: string, runId?: string }} options
 */
export function assertCs2RecoverySnapshot(snapshot, options = {}) {
  const { nowMs = Date.now(), phase = null, recoveryId, runId } = options;
  if (!snapshot || typeof snapshot !== 'object') fail('RECOVERY_SNAPSHOT_UNAVAILABLE');
  if (snapshot.maintenance !== true) fail('MAINTENANCE_NOT_ENABLED');
  if (snapshot.activeMatches !== 0) fail('ACTIVE_MATCHES_PRESENT');

  const servers = snapshot.servers;
  if (!Array.isArray(servers) || servers.length !== REQUIRED_CS2_RECOVERY_SERVERS.length) {
    fail('CS2_SERVER_SET_INCOMPLETE');
  }
  const names = servers.map(server => server?.name);
  if (new Set(names).size !== REQUIRED_CS2_RECOVERY_SERVERS.length
    || REQUIRED_CS2_RECOVERY_SERVERS.some(name => !names.includes(name))) {
    fail('CS2_SERVER_SET_INCOMPLETE');
  }

  for (const name of REQUIRED_CS2_RECOVERY_SERVERS) {
    const server = servers.find(item => item.name === name);
    if (server.status !== 'READY') fail('CS2_SERVER_NOT_READY', name);
    if (server.managerReady !== true) fail('CS2_MANAGER_NOT_READY', name);
    if (server.matchId) fail('CS2_SERVER_HAS_MATCH', name);
    if (server.processId !== null && server.processId !== undefined) fail('CS2_SERVER_HAS_PROCESS_ID', name);
    if (server.gameProcessReady !== false) fail('CS2_GAME_PROCESS_NOT_STOPPED', name);
    if (server.gameProcessStatus !== 'STOPPED') fail('CS2_GAME_PROCESS_NOT_STOPPED', name);
    if (server.gameProcessPid !== null && server.gameProcessPid !== undefined) fail('CS2_GAME_PROCESS_PID_PRESENT', name);
    if (server.heartbeatFresh !== true) fail('CS2_HEARTBEAT_STALE', name);
    const heartbeatMs = parseTime(server.lastHeartbeat);
    const ageMs = nowMs - heartbeatMs;
    if (!Number.isFinite(heartbeatMs) || ageMs < 0 || ageMs > 30_000) fail('CS2_HEARTBEAT_STALE', name);
  }

  const updateStatus = snapshot.updateStatus;
  if (phase === 'STATUS_UPDATED' || phase === 'COMPLETED') {
    if (updateStatus?.status !== 'SUCCEEDED'
      || updateStatus?.recoveryId !== recoveryId
      || updateStatus?.recoveredFromRunId !== runId) {
      fail('RECOVERY_STATUS_MISMATCH');
    }
  } else if (updateStatus?.status !== 'FAILED' || updateStatus?.runId !== runId) {
    fail('FAILED_UPDATE_STATUS_MISMATCH');
  }
  return true;
}

export function assertFailedCs2UpdateRun(run, runId) {
  if (!run || run.id?.toLowerCase() !== validateCs2RecoveryRunId(runId)) fail('FAILED_UPDATE_RUN_NOT_FOUND');
  if (run.status !== 'FAILED') fail('OLD_UPDATE_RUN_NOT_FAILED');
  const failureEvidence = `${String(run.errorCode ?? '')} ${String(run.errorMessage ?? '')}`;
  if (!failureEvidence.includes('INVALID_RUN_UPDATE')) fail('UNEXPECTED_UPDATE_FAILURE');
  if (!run.publicBuildId || !run.installedBuildIdAfter || run.publicBuildId !== run.installedBuildIdAfter) {
    fail('PERSISTED_BUILD_EVIDENCE_MISSING');
  }
  if (!run.serverVersionAfter) fail('PERSISTED_SERVER_VERSION_MISSING');
  if (!Array.isArray(run.checkedInstances) || run.checkedInstances.length !== REQUIRED_CS2_RECOVERY_SERVERS.length) {
    fail('PERSISTED_INSTANCE_EVIDENCE_MISSING');
  }
  const checkedByName = new Map();
  for (const row of run.checkedInstances) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.serverName !== 'string'
      || checkedByName.has(row.serverName)) fail('PERSISTED_INSTANCE_EVIDENCE_INVALID');
    checkedByName.set(row.serverName, row);
  }
  if (checkedByName.size !== REQUIRED_CS2_RECOVERY_SERVERS.length) fail('PERSISTED_INSTANCE_EVIDENCE_MISSING');
  for (const name of REQUIRED_CS2_RECOVERY_SERVERS) {
    const row = checkedByName.get(name);
    if (!row || row.status !== 'READY' || row.buildId !== run.installedBuildIdAfter
      || row.serverVersion !== run.serverVersionAfter || row.controlFilesVerified !== true
      || !['READY', 'READY_WITH_SHUTDOWN_DIAGNOSTIC'].includes(row.smokeStatus)
      || row.gameProcessReady !== false || row.gameProcessStatus !== 'STOPPED'
      || (row.gameProcessPid !== null && row.gameProcessPid !== undefined)) {
      fail('PERSISTED_INSTANCE_EVIDENCE_MISMATCH', name);
    }
  }
  return true;
}

export function assertCs2RecoveryMarkerForPhase({ marker, phase, recoveryId, ownershipToken, nowMs = Date.now(), pidIsAlive = () => false }) {
  const owned = isCs2RecoveryMarker(marker, recoveryId, ownershipToken);
  if (phase === 'NOT_STARTED' || phase === 'PREPARED') {
    if (!marker) fail('SYNC_MARKER_MISSING_BEFORE_RECOVERY');
    if (owned) return 'OWNED_RECOVERY_MARKER';
    if (!isLegacyCs2UpdaterMarkerContent(marker.content)
      || Date.parse(marker.content.startedAt) > nowMs + 30_000) {
      fail('SYNC_MARKER_ORIGIN_INVALID');
    }
    if (!isCs2MarkerStale(marker, nowMs)) fail('SYNC_MARKER_NOT_STALE');
    if (pidIsAlive(marker.content.pid)) fail('ORIGINAL_UPDATER_PID_STILL_ACTIVE');
    return 'STALE_ORIGINAL_MARKER';
  }
  if (phase === 'MARKER_REFRESHED') {
    if (!marker) return 'RECOVERY_MARKER_MISSING_CAN_RECREATE';
    if (!owned) fail('SYNC_MARKER_OWNERSHIP_MISMATCH');
    return 'OWNED_RECOVERY_MARKER';
  }
  if (phase === 'STATUS_UPDATED' || phase === 'COMPLETED') {
    if (!marker) return 'MARKER_ALREADY_REMOVED';
    if (!owned) fail('SYNC_MARKER_OWNERSHIP_MISMATCH');
    return 'OWNED_RECOVERY_MARKER';
  }
  fail('INVALID_RECOVERY_PHASE', String(phase));
}

/**
 * Coordinate the recovery state machine. All network and filesystem work is injected,
 * which lets tests exercise failures and interrupted runs without a database or VPS.
 * Maintenance is checked on every inspection and is never disabled by this function.
 */
export async function runControlledCs2Recovery({
  runId,
  api,
  marker,
  now = () => Date.now(),
  pidIsAlive = () => false,
  assertNoConflictingProcesses = async () => {},
  confirm = false,
}) {
  const normalizedRunId = validateCs2RecoveryRunId(runId);
  const recoveryId = cs2RecoveryIdForRun(normalizedRunId);
  if (confirm !== true) fail('EXPLICIT_CONFIRMATION_REQUIRED');

  const ensureQuiescent = async () => {
    await assertNoConflictingProcesses();
  };

  const inspectAndValidate = async phase => {
    const state = await api.inspect(normalizedRunId);
    const effectivePhase = phase ?? state.ledger?.phase ?? 'NOT_STARTED';
    if (state.ledger && (state.ledger.recoveryId !== recoveryId || state.ledger.runId?.toLowerCase() !== normalizedRunId)) {
      fail('RECOVERY_LEDGER_MISMATCH');
    }
    assertFailedCs2UpdateRun(state.run, normalizedRunId);
    assertCs2RecoverySnapshot(state.snapshot, {
      nowMs: now(), phase: effectivePhase, recoveryId, runId: normalizedRunId,
    });
    return { ...state, phase: effectivePhase };
  };

  await ensureQuiescent();
  let state = await inspectAndValidate(null);
  let markerState = await marker.read();
  assertCs2RecoveryMarkerForPhase({
    marker: markerState, phase: state.phase, recoveryId, ownershipToken: state.ledger?.markerOwnershipToken, nowMs: now(), pidIsAlive,
  });

  // The API transaction repeats all database gates immediately before creating the ledger.
  await ensureQuiescent();
  state = await api.action('prepare', { runId: normalizedRunId, recoveryId });
  let phase = state.phase;

  if (phase === 'PREPARED') {
    markerState = await marker.read();
    const disposition = assertCs2RecoveryMarkerForPhase({
      marker: markerState, phase, recoveryId, ownershipToken: state.ledger?.markerOwnershipToken, nowMs: now(), pidIsAlive,
    });
    const markerAgeMs = markerState && Number.isFinite(markerState.mtimeMs)
      ? now() - markerState.mtimeMs
      : Number.POSITIVE_INFINITY;
    // If a previous process wrote the marker but stopped before recording the DB phase,
    // refresh it when older than 30s so the API's 60s evidence window is satisfied on retry.
    if (disposition !== 'OWNED_RECOVERY_MARKER' || markerAgeMs > 30_000 || markerAgeMs < 0) {
      await ensureQuiescent();
      await marker.writeRecoveryMarker({
        recoveryId,
        ownershipToken: state.ledger.markerOwnershipToken,
        pid: process.pid,
        startedAt: new Date(now()).toISOString(),
        source: 'duelplay-controlled-recovery',
      }, markerState);
    }
    markerState = await marker.read();
    if (!isCs2RecoveryMarker(markerState, recoveryId, state.ledger?.markerOwnershipToken)) fail('SYNC_MARKER_REFRESH_FAILED');
    await ensureQuiescent();
    state = await api.action('marker-refreshed', {
      runId: normalizedRunId, recoveryId,
      markerPid: markerState.content.pid,
      markerOwnershipToken: markerState.content.ownershipToken,
      markerDev: markerState.dev,
      markerIno: markerState.ino,
      markerMtimeMs: markerState.mtimeMs,
      markerSize: markerState.size,
    });
    phase = state.phase;
  }

  if (phase === 'MARKER_REFRESHED') {
    markerState = await marker.read();
    let markerRecreated = false;
    if (!isCs2RecoveryMarker(markerState, recoveryId, state.ledger?.markerOwnershipToken)) {
      if (markerState) fail('SYNC_MARKER_OWNERSHIP_MISMATCH');
      await ensureQuiescent();
      await marker.writeRecoveryMarker({
        recoveryId,
        ownershipToken: state.ledger.markerOwnershipToken,
        pid: process.pid,
        startedAt: new Date(now()).toISOString(),
        source: 'duelplay-controlled-recovery',
      }, null);
      markerState = await marker.read();
      markerRecreated = true;
    }
    if (!isCs2RecoveryMarker(markerState, recoveryId, state.ledger?.markerOwnershipToken)) fail('SYNC_MARKER_REFRESH_FAILED');
    if (!markerRecreated && !markerMatchesLedger(markerState, state.ledger)) {
      fail('SYNC_MARKER_OWNERSHIP_MISMATCH', 'marker inode differs from recovery journal');
    }

    // If the marker disappeared after MARKER_REFRESHED, persist the replacement's
    // exact identity before progressing so cleanup attestation is bound to it.
    if (markerRecreated) {
      await ensureQuiescent();
      state = await api.action('marker-refreshed', {
        runId: normalizedRunId, recoveryId,
        markerPid: markerState.content.pid,
        markerOwnershipToken: markerState.content.ownershipToken,
        markerDev: markerState.dev,
        markerIno: markerState.ino,
        markerMtimeMs: markerState.mtimeMs,
        markerSize: markerState.size,
      });
      phase = state.phase;
    }

    // Fresh read before the DB mutation; the route repeats these checks transactionally.
    state = await inspectAndValidate('MARKER_REFRESHED');
    await ensureQuiescent();
    state = await api.action('complete', { runId: normalizedRunId, recoveryId });
    phase = state.phase;
  }

  if (phase === 'STATUS_UPDATED') {
    // A signed, one-time receipt is required by the API. It includes the marker
    // inode recorded in the journal, recovery ID, and STATUS_UPDATED phase.
    state = await inspectAndValidate('STATUS_UPDATED');
    markerState = await marker.read();
    const disposition = assertCs2RecoveryMarkerForPhase({
      marker: markerState, phase, recoveryId, ownershipToken: state.ledger?.markerOwnershipToken, nowMs: now(), pidIsAlive,
    });
    let cleanupResult;
    if (disposition === 'OWNED_RECOVERY_MARKER') {
      await ensureQuiescent();
      cleanupResult = await marker.removeOwnedRecoveryMarker(recoveryId, state.ledger.markerOwnershipToken, {
        dev: state.ledger.markerDev, ino: state.ledger.markerIno,
        mtimeMs: state.ledger.markerMtimeMs, size: state.ledger.markerSize,
      });
      if (!cleanupResult) fail('SYNC_MARKER_CLEANUP_FAILED');
    } else {
      cleanupResult = {
        marker: {
          dev: state.ledger?.markerDev,
          ino: state.ledger?.markerIno,
          mtimeMs: state.ledger?.markerMtimeMs,
          size: state.ledger?.markerSize,
        },
        disposition: 'ABSENT_ON_RETRY',
        observedAt: new Date(now()).toISOString(),
      };
    }
    if (await marker.read()) fail('SYNC_MARKER_CLEANUP_FAILED_OR_MARKER_REPLACED');
    if (!state.ledger?.markerCleanupNonce) fail('RECOVERY_MARKER_CLEANUP_NONCE_MISSING');
    await ensureQuiescent();
    state = await api.action('finalize', {
      runId: normalizedRunId,
      recoveryId,
      markerReceipt: {
        recoveryId,
        phase: 'STATUS_UPDATED',
        nonce: state.ledger.markerCleanupNonce,
        marker: cleanupResult.marker,
        executorPid: process.pid,
        disposition: cleanupResult.disposition,
        observedAt: cleanupResult.observedAt,
      },
    });
    phase = state.phase;
  }

  if (phase === 'COMPLETED') {
    // COMPLETED means cleanup was already attested. Never delete a marker after
    // completion: a reappearing file needs operator review, regardless of its name.
    markerState = await marker.read();
    if (markerState) fail('SYNC_MARKER_REAPPEARED_AFTER_COMPLETION');
    const finalState = await inspectAndValidate('COMPLETED');
    if (finalState.snapshot.maintenance !== true) fail('MAINTENANCE_NOT_ENABLED');
    if (await marker.read()) fail('SYNC_MARKER_NOT_CLEARED');
    return { ok: true, recoveryId, runId: normalizedRunId, phase: 'COMPLETED', maintenanceRemainsEnabled: true };
  }

  fail('RECOVERY_INCOMPLETE', String(phase));
}
