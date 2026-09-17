export type LiveMatchState = {
  state: string | null;
  connectUrl: string | null;
  connectionPhaseCompleted: boolean;
  connectedCount: number;
  connectionSlots: number;
  heartbeatAgeMs: number | null;
  serverHealthy: boolean;
};

export function buildLiveMatchState(
  serverConfig: unknown,
  nowMs = Date.now(),
  lastHeartbeat?: Date | string | null,
): LiveMatchState {
  const cfg = serverConfig && typeof serverConfig === "object" && !Array.isArray(serverConfig)
    ? serverConfig as Record<string, unknown>
    : {};
  const ids = Array.isArray(cfg.connectedSteamIds)
    ? [...new Set(idsToStrings(cfg.connectedSteamIds))]
    : [];
  const heartbeatAgeMs = lastHeartbeat
    ? Math.max(0, nowMs - new Date(lastHeartbeat).getTime())
    : null;
  return {
    state: typeof cfg.state === "string" ? cfg.state : null,
    connectUrl: typeof cfg.connectUrl === "string" ? cfg.connectUrl : null,
    connectionPhaseCompleted: cfg.connectionPhaseCompleted === true,
    connectedCount: Math.min(ids.length, 2),
    connectionSlots: 2,
    heartbeatAgeMs,
    serverHealthy: heartbeatAgeMs !== null && heartbeatAgeMs <= 90_000,
  };
}

function idsToStrings(values: unknown[]): string[] {
  return values.map(String).map(value => value.trim()).filter(Boolean);
}
