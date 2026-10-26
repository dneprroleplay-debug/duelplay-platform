export const CONTROL_FILES = [
  'csgo/steam.inf',
  'bin/linuxsteamrt64/cs2',
  'bin/linuxsteamrt64/libengine2.so',
];

export const DEEP_VERIFY_UTC_DAY = 0;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function parseBooleanFlag(value) {
  return TRUE_VALUES.has(String(value ?? '').trim().toLowerCase());
}

export function parseSteamPublicBuildId(output) {
  const match = String(output ?? '').match(/"branches"\s*\{\s*"public"\s*\{\s*"buildid"\s*"(\d+)"/i);
  return match ? match[1] : null;
}

export function isDeepVerifyDay(now = new Date(), deepVerifyUtcDay = DEEP_VERIFY_UTC_DAY) {
  return now.getUTCDay() === deepVerifyUtcDay;
}

export function previousRunWasSuccessful(status) {
  return status === 'SUCCEEDED';
}

export function selectSyncMode({
  buildIdBefore,
  buildIdAfter,
  previousStatus,
  now = new Date(),
  forceDeep = false,
  deepVerifyUtcDay = DEEP_VERIFY_UTC_DAY,
} = {}) {
  const reasons = [];
  if (!buildIdBefore || !buildIdAfter) {
    reasons.push('build id is unavailable');
  } else if (buildIdBefore !== buildIdAfter) {
    reasons.push(`build id changed (${buildIdBefore} -> ${buildIdAfter})`);
  }
  if (forceDeep) reasons.push('DUELPLAY_CS2_DEEP_VERIFY is enabled');
  if (isDeepVerifyDay(now, deepVerifyUtcDay)) reasons.push('scheduled UTC deep-verification day');
  if (!previousRunWasSuccessful(previousStatus)) reasons.push(`previous update status is ${previousStatus ?? 'unknown'} (not SUCCEEDED)`);
  return { deep: reasons.length > 0, reasons };
}

export function selectUpdateAction({
  latestBuildId,
  installedBuildId,
  instanceDrift = [],
} = {}) {
  if (!latestBuildId || !installedBuildId) {
    return { action: 'BLOCKED', runAppUpdate: false, runSync: false, deep: false, reason: 'Steam public or installed Build ID is unavailable' };
  }
  if (latestBuildId === installedBuildId) {
    const changes = Array.isArray(instanceDrift) ? instanceDrift : [];
    if (changes.length) {
      return {
        action: 'INSTANCE_DRIFT',
        runAppUpdate: false,
        runSync: false,
        deep: false,
        changes,
        reason: `${changes.length} instance file difference(s) found while Steam Build ID is unchanged`,
      };
    }
    return {
      action: 'NO_UPDATE',
      runAppUpdate: false,
      runSync: false,
      deep: false,
      reason: `Steam public and installed Build ID both equal ${latestBuildId}`,
    };
  }

  return {
    action: 'UPDATE',
    runAppUpdate: true,
    runSync: true,
    deep: true,
    reason: `Steam Build ID changed (${installedBuildId} -> ${latestBuildId})`,
  };
}

export function assertManagersIdle(healthRecords) {
  for (const { server, health } of healthRecords) {
    if (!health || health.ok !== true || health.matchId || health.gameProcessStatus !== 'STOPPED' || health.gameProcessPid) {
      throw new Error(`${server.name}: not idle (matchId=${health?.matchId ?? 'unknown'}, status=${health?.gameProcessStatus ?? 'unknown'}, pid=${health?.gameProcessPid ?? 'unknown'}); deferring update.`);
    }
  }
  return true;
}

export function classifySmokeProcessExit({ exitCode, signalCode, readinessChecksPassed, quitRequested, output } = {}) {
  const text = String(output ?? '');
  const crashOutput = /segmentation fault|core dumped/i.test(text);
  if (readinessChecksPassed === true && quitRequested === true && !signalCode && exitCode === 0 && !crashOutput) return { status: 'READY', diagnostic: null };

  const postReadinessQuitSegfault = readinessChecksPassed === true
    && quitRequested === true
    && crashOutput
    && (exitCode === 139 || signalCode === 'SIGSEGV')
    && /QueueNewRequest\(\s*Quitting/i.test(text)
    && /Server shutting down:\s*NETWORK_DISCONNECT_EXITING/i.test(text);
  if (postReadinessQuitSegfault) {
    return {
      status: 'READY_WITH_SHUTDOWN_DIAGNOSTIC',
      diagnostic: {
        code: 'POST_READINESS_SHUTDOWN_SIGSEGV',
        exitCode: exitCode ?? null,
        signal: signalCode ?? 'SIGSEGV',
        readinessChecksPassed: true,
        quitRequested: true,
      },
    };
  }

  return {
    status: 'FAILED',
    diagnostic: {
      code: crashOutput ? 'SMOKE_PROCESS_CRASH' : 'SMOKE_PROCESS_EXIT_UNEXPECTED',
      exitCode: exitCode ?? null,
      signal: signalCode ?? null,
      readinessChecksPassed: readinessChecksPassed === true,
      quitRequested: quitRequested === true,
    },
  };
}



export async function syncInstances({ servers, deep, sync, verify, log = () => {} }) {
  let completed = 0;
  for (const server of servers) {
    const mode = deep ? 'checksum-based incremental' : 'quick metadata incremental';
    log(`${server.name}: synchronizing changed game files with ${mode} mode.`);
    await sync(server, deep);
    try {
      await verify(server);
    } catch (error) {
      if (deep) throw error;
      log(`${server.name}: quick synchronization did not verify (${error instanceof Error ? error.message : 'unknown error'}); retrying with checksum-based incremental sync.`);
      await sync(server, true);
      try {
        await verify(server);
      } catch (fallbackError) {
        throw new Error(
          `${server.name}: checksum-based incremental synchronization did not verify: ${fallbackError instanceof Error ? fallbackError.message : 'unknown error'}`,
          { cause: fallbackError },
        );
      }
    }
    completed += 1;
  }
  return { completed };
}
