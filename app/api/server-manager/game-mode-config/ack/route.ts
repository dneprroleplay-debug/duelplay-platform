import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { recordGameModeConfigAck } from "@/lib/game-mode-config-store";
import { isServerManagerRequest } from "../../auth";

export async function POST(request: NextRequest) {
  try {
    await prisma.$transaction(tx => enforceIpRateLimit(tx, getClientIp(request), "SERVER_MANAGER_MODE_CONFIG_ACK", 120, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    throw error;
  }
  if (!isServerManagerRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 }); }

  const version = Number(body.version);
  const serverName = String(body.serverName ?? "");
  const checksum = String(body.checksum ?? "");
  const status = body.status === "FAILED" ? "FAILED" : body.status === "APPLIED" ? "APPLIED" : body.status === "STAGED" ? "STAGED" : null;
  const modeControllerVersion = typeof body.modeControllerVersion === "string" ? body.modeControllerVersion : null;
  const capabilities = Array.isArray(body.capabilities) && body.capabilities.every(value => typeof value === "string") ? body.capabilities as string[] : [];
  const error = body.error === undefined || body.error === null ? null : String(body.error).slice(0, 500);
  if (!Number.isInteger(version) || version < 1 || !/^[a-f0-9]{64}$/i.test(checksum) || !status || (status === "FAILED" && !error) || (status !== "FAILED" && (!modeControllerVersion || !capabilities.length))) {
    return NextResponse.json({ error: "Invalid acknowledgement payload", errorCode: "INVALID_CONFIG_ACK" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(tx => recordGameModeConfigAck(tx, { version, serverName, checksum, status, modeControllerVersion, capabilities, error }));
    return NextResponse.json({ ok: true, version, serverName, status, publishedVersion: result.state.publishedVersion, pendingVersion: result.state.pendingVersion });
  } catch (caught) {
    const code = caught instanceof Error ? caught.message : "";
    if (code === "UNKNOWN_CONFIG_SERVER") return NextResponse.json({ error: "Unknown server", errorCode: code }, { status: 400 });
    if (["STALE_CONFIG_VERSION", "CONFIG_VERSION_NOT_FOUND", "CONFIG_CHECKSUM_MISMATCH", "CONFIG_SERVER_NOT_REGISTERED", "MODE_CONTROLLER_VERSION_MISMATCH", "MODE_CONTROLLER_CAPABILITIES_MISSING"].includes(code)) {
      return NextResponse.json({ error: "Configuration acknowledgement was rejected", errorCode: code }, { status: 409 });
    }
    console.error("[SERVER_MANAGER_MODE_CONFIG_ACK]", caught);
    return NextResponse.json({ error: "Could not record configuration acknowledgement", errorCode: "CONFIG_ACK_FAILED" }, { status: 500 });
  }
}
