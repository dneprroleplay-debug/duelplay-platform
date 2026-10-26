export async function pollCs2UpdateSchedule({ readSchedule, updateHeartbeat, updaterIsActive, claimRun, startUpdater, readRun, reportFailure }) {
  let config;
  try {
    config = await readSchedule();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SCHEDULE_API_UNAVAILABLE';
    try { await updateHeartbeat({ agentStatus: 'ERROR', agentError: message }); } catch {}
    return { action: 'BLOCKED', reason: 'SCHEDULE_API_UNAVAILABLE' };
  }

  if (!config?.schedule || config.invalid === true || typeof config.schedule.enabled !== 'boolean') {
    try { await updateHeartbeat({ agentStatus: 'ERROR', agentError: 'SCHEDULE_INVALID' }); } catch {}
    return { action: 'BLOCKED', reason: 'SCHEDULE_INVALID' };
  }
  if (!config.schedule.enabled) {
    await updateHeartbeat({ agentStatus: 'DISABLED', agentError: null });
    return { action: 'DISABLED' };
  }
  if (!config.due) {
    await updateHeartbeat({ agentStatus: 'ONLINE', agentError: null });
    return { action: 'NOT_DUE' };
  }
  if (await updaterIsActive()) {
    await updateHeartbeat({ agentStatus: 'UPDATE_RUNNING', agentError: null });
    return { action: 'UPDATE_RUNNING' };
  }

  const claim = await claimRun({
    localDate: config.due.localDate,
    localTime: config.due.localTime,
    revision: config.schedule.revision,
  });
  if (!claim?.claimed || !claim.runId) {
    await updateHeartbeat({ agentStatus: 'ONLINE', agentError: null });
    return { action: claim?.reason ?? 'NOT_CLAIMED', runId: claim?.runId ?? null };
  }

  await updateHeartbeat({ agentStatus: 'UPDATE_DUE', agentError: null });
  let startResult;
  try {
    startResult = await startUpdater(claim.runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UPDATE_SERVICE_START_FAILED';
    try { await reportFailure(claim.runId, { errorCode: 'UPDATE_SERVICE_START_FAILED', errorMessage: message }); } catch {}
    try { await updateHeartbeat({ agentStatus: 'ERROR', agentError: message }); } catch {}
    return { action: 'FAILED', runId: claim.runId, error: message };
  }

  let run = null;
  try { run = await readRun(claim.runId); } catch {}
  if (!run || run.status === 'RUNNING') {
    const errorCode = startResult?.exitCode === 0 ? 'RUN_FINISH_STATUS_MISSING' : 'UPDATE_SERVICE_FAILED';
    const errorMessage = startResult?.exitCode === 0
      ? 'Updater service exited without a terminal run status.'
      : `Updater service ended with exit=${startResult?.exitCode ?? 'null'} signal=${startResult?.signal ?? 'none'}.`;
    try { await reportFailure(claim.runId, { errorCode, errorMessage }); } catch {}
    try { await updateHeartbeat({ agentStatus: 'ERROR', agentError: errorMessage }); } catch {}
    return { action: 'FAILED', runId: claim.runId, error: errorMessage };
  }

  const failed = ['FAILED', 'BLOCKED', 'INSTANCE_DRIFT'].includes(String(run.status));
  try { await updateHeartbeat({ agentStatus: failed ? 'ERROR' : 'ONLINE', agentError: run.errorMessage ?? null }); } catch {}
  return { action: run.status, runId: claim.runId, exitCode: startResult?.exitCode ?? null };
}
