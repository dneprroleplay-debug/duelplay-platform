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

export function isDeepVerifyDay(now = new Date(), deepVerifyUtcDay = DEEP_VERIFY_UTC_DAY) {
  return now.getUTCDay() === deepVerifyUtcDay;
}

export function previousRunWasUnsuccessful(status) {
  return status === 'FAILED' || status === 'RUNNING';
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
  if (previousRunWasUnsuccessful(previousStatus)) reasons.push(`previous update status is ${previousStatus}`);
  return { deep: reasons.length > 0, reasons };
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
