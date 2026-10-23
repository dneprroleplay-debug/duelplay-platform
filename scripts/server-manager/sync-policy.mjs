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
  previousStatus,
  state,
  sharedIntegrityVerified,
  instancesSynced,
  forceDeep = false,
  scheduledDeep = false,
} = {}) {
  if (!latestBuildId || !installedBuildId) {
    return { action: 'RECOVERY', runSteamCmd: true, runSync: true, deep: true, reason: 'Steam or installed Build ID is unavailable' };
  }
  if (latestBuildId !== installedBuildId) {
    return { action: 'UPDATE', runSteamCmd: true, runSync: true, deep: true, reason: `Build ID changed (${installedBuildId} -> ${latestBuildId})` };
  }

  const lastSuccessful = state?.lastSuccessful;
  const lastAttempt = state?.lastAttempt?.result;
  const validPriorSuccess = previousStatus === 'SUCCEEDED'
    && lastSuccessful?.result === 'SUCCEEDED'
    && lastSuccessful.buildId === latestBuildId
    && ['SUCCEEDED', 'SKIPPED'].includes(lastAttempt);
  if (!validPriorSuccess) {
    return { action: 'RECOVERY', runSteamCmd: true, runSync: true, deep: true, reason: `previous update state is ${previousStatus ?? 'unknown'} or unverified` };
  }
  if (!sharedIntegrityVerified) {
    return { action: 'RECOVERY', runSteamCmd: true, runSync: true, deep: true, reason: 'shared installation integrity is not confirmed' };
  }
  if (forceDeep || scheduledDeep) {
    return { action: 'VERIFY', runSteamCmd: false, runSync: true, deep: true, reason: forceDeep ? 'forced deep verification' : 'scheduled deep verification' };
  }
  if (!instancesSynced) {
    return { action: 'SYNC', runSteamCmd: false, runSync: true, deep: false, reason: 'one or more instance roots differ from the confirmed shared build' };
  }
  return { action: 'SKIP', runSteamCmd: false, runSync: false, deep: false, reason: 'Steam Build ID, saved success state, shared hashes, and all three instance roots match' };
}

export async function syncInstances({ servers, deep, sync, verify, log = () => {} }) {
  let completed = 0;
  for (const server of servers) {
    const mode = deep ? 'full checksum' : 'quick size+mtime';
    log(`${server.name}: synchronizing game files with ${mode}.`);
    await sync(server, deep);
    try {
      await verify(server);
    } catch (error) {
      if (deep) throw error;
      log(`${server.name}: quick synchronization did not verify (${error instanceof Error ? error.message : 'unknown error'}); retrying with full checksum.`);
      await sync(server, true);
      try {
        await verify(server);
      } catch (fallbackError) {
        throw new Error(
          `${server.name}: full checksum synchronization did not verify: ${fallbackError instanceof Error ? fallbackError.message : 'unknown error'}`,
          { cause: fallbackError },
        );
      }
    }
    completed += 1;
  }
  return { completed };
}
