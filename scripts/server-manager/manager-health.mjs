export function managerHealthSnapshot({ serverId, gamePort, managerPort, current, readyAt, lastGsiAt = 0, now = Date.now() }) {
  const child = current?.process;
  const running = Boolean(child?.pid && child.exitCode === null && child.signalCode === null);
  const status = !running ? 'STOPPED' : readyAt ? 'READY' : 'STARTING';
  return {
    ok: true,
    serverId,
    managerReady: true,
    managerPort,
    gamePort: current?.port ?? gamePort,
    gameProcessReady: running && Boolean(readyAt),
    gameProcessStatus: status,
    gameProcessPid: running ? child.pid : null,
    matchId: current?.id ?? null,
    gsiAgeMs: lastGsiAt ? now - lastGsiAt : null,
  };
}
