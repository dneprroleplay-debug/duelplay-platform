export type SteamTradeStatus = "NOT_CONFIGURED" | "TRADE_PENDING" | "TRADE_SENT" | "TRADE_ACCEPTED" | "TRADE_FAILED";

export type SteamTradeRequest = {
  inventoryItemId: string;
  steamId: string;
  assetId?: string | null;
};

export interface SteamTradeProvider {
  createTrade(input: SteamTradeRequest): Promise<{ externalTradeId: string; status: SteamTradeStatus }>;
  cancelTrade(externalTradeId: string): Promise<void>;
  getTradeStatus(externalTradeId: string): Promise<SteamTradeStatus>;
}

const providerName = process.env.STEAM_TRADE_PROVIDER?.trim().toLowerCase() || "none";
const providerUrl = process.env.STEAM_TRADE_PROVIDER_URL?.trim() || "";
const providerSecret = process.env.STEAM_TRADE_PROVIDER_SECRET?.trim() || "";

export const steamTradeConfig = {
  enabled: process.env.STEAM_TRADE_ENABLED === "true",
  provider: providerName,
  configured: process.env.STEAM_TRADE_ENABLED === "true" && providerName !== "none" && Boolean(providerUrl && providerSecret),
};

export function assertSteamTradeReady() {
  if (!steamTradeConfig.configured) throw new Error("STEAM_TRADE_NOT_CONFIGURED");
}

function normalizeStatus(value: unknown): SteamTradeStatus {
  const status = String(value || "TRADE_PENDING").toUpperCase();
  if (["TRADE_PENDING", "TRADE_SENT", "TRADE_ACCEPTED", "TRADE_FAILED"].includes(status)) return status as SteamTradeStatus;
  throw new Error("STEAM_TRADE_PROVIDER_INVALID_STATUS");
}

async function providerRequest(path: string, body?: unknown) {
  if (!providerUrl || !providerSecret) throw new Error("STEAM_TRADE_NOT_CONFIGURED");
  const response = await fetch(`${providerUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${providerSecret}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error("STEAM_TRADE_PROVIDER_INVALID_JSON"); }
  if (!response.ok) throw new Error(`STEAM_TRADE_PROVIDER_${response.status}`);
  return data;
}

class HttpSteamTradeProvider implements SteamTradeProvider {
  async createTrade(input: SteamTradeRequest) {
    const data = await providerRequest("/trades", input);
    const externalTradeId = String(data.externalTradeId || data.id || "").trim();
    if (!externalTradeId) throw new Error("STEAM_TRADE_PROVIDER_MISSING_ID");
    return { externalTradeId, status: normalizeStatus(data.status) };
  }
  async cancelTrade(externalTradeId: string) {
    await providerRequest(`/trades/${encodeURIComponent(externalTradeId)}/cancel`, {});
  }
  async getTradeStatus(externalTradeId: string) {
    const data = await providerRequest(`/trades/${encodeURIComponent(externalTradeId)}/status`, {});
    return normalizeStatus(data.status);
  }
}

export function getSteamTradeProvider(): SteamTradeProvider {
  assertSteamTradeReady();
  if (providerName === "http") return new HttpSteamTradeProvider();
  throw new Error("STEAM_TRADE_PROVIDER_UNSUPPORTED");
}
