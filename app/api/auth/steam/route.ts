import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { hashToken, SESSION_COOKIE } from "@/lib/auth";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { prisma } from "@/lib/prisma";
import { isSameOriginRequest } from "@/lib/steam-link-security";

const STATE_COOKIE = "duelplay_steam_state";

function getSessionCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const raw = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return null; }
}

function isSameOrigin(request: Request) {
  return isSameOriginRequest(request.headers.get("origin"), new URL(getBaseUrl(request)).origin);
}

function getBaseUrl(request: Request) {
  const configured = process.env.STEAM_RETURN_URL?.trim();
  if (configured) return configured.replace(/\/api\/auth\/steam\/callback\/?$/, "").replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function buildSteamRedirect(baseUrl: string, state: string) {
  const returnUrl = `${baseUrl}/api/auth/steam/callback`;
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${returnUrl}?state=${state}`,
    "openid.realm": baseUrl,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `https://steamcommunity.com/openid/login?${params.toString()}`;
}

function setStateCookie(response: NextResponse, state: string, intent: "login" | "link", ref: string, popup: boolean) {
  response.cookies.set({
    name: STATE_COOKIE,
    value: `${state}:${intent}:${ref}:${popup ? "popup" : "tab"}`,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 1800,
  });
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Linking changes account identity and must use the authenticated, same-origin POST below.
  if (url.searchParams.get("intent") === "link") {
    return NextResponse.json({ error: "Steam linking must be started with an authenticated same-origin POST." }, { status: 405, headers: { Allow: "POST" } });
  }
  return startSteamLogin(request);
}

async function startSteamLogin(request: Request) {
  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "STEAM_LOGIN_START", 20, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      return NextResponse.json({ error: "Слишком много попыток входа. Попробуйте позже." }, { status: 429 });
    }
    throw error;
  }

  const url = new URL(request.url);
  const state = randomBytes(24).toString("hex");
  const ref = url.searchParams.get("ref")?.trim().toUpperCase() ?? "";
  const popup = url.searchParams.get("popup") === "1";
  const baseUrl = getBaseUrl(request);
  const response = NextResponse.redirect(buildSteamRedirect(baseUrl, state));
  return setStateCookie(response, state, "login", ref, popup);
}

export async function POST(request: Request) {
  // This endpoint initiates account linking, a state-changing operation. Reject
  // absent, malformed, cross-origin, and opaque Origin headers.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin Steam linking is not allowed." }, { status: 403 });
  }

  const rawSessionToken = getSessionCookie(request);
  if (!rawSessionToken) return NextResponse.json({ error: "Sign in to DuelPlay before linking Steam." }, { status: 401 });

  const session = await prisma.userSession.findFirst({
    where: { token: hashToken(rawSessionToken), isRevoked: false, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true, user: { select: { status: true, deletedAt: true } } },
  });
  if (!session || session.user.status !== "ACTIVE" || session.user.deletedAt) {
    return NextResponse.json({ error: "Your DuelPlay session is no longer valid." }, { status: 401 });
  }

  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "STEAM_LINK_START", 10, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      return NextResponse.json({ error: "Too many Steam linking attempts. Try again later." }, { status: 429 });
    }
    throw error;
  }

  const url = new URL(request.url);
  const state = randomBytes(24).toString("hex");
  const popup = url.searchParams.get("popup") === "1";
  const baseUrl = getBaseUrl(request);
  const stateHash = hashToken(state);

  // Reuse the existing SecurityEvent store instead of adding a migration. The
  // callback atomically consumes this server-side record and binds it to this
  // exact user + session row; the browser cookie alone is not authoritative.
  await prisma.securityEvent.create({
    data: {
      userId: session.userId,
      eventType: "STEAM_LINK_STATE_ISSUED",
      severity: "INFO",
      ipAddress: ip,
      metadata: { stateHash, sessionId: session.id, popup },
    },
  });

  const response = NextResponse.redirect(buildSteamRedirect(baseUrl, state), 303);
  return setStateCookie(response, state, "link", "", popup);
}
