import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken, newSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { isBoundToSameSession } from "@/lib/steam-link-security";

const STATE_COOKIE = "duelplay_steam_state";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const STEAM_CHANNEL = "duelplay-steam-oauth-v1";

type SteamProfile = { nickname: string; avatarUrl: string | null };
type OAuthIntent = "login" | "link";

function getBaseUrl(request: Request) {
  const configured = process.env.STEAM_RETURN_URL?.trim();
  if (configured) return configured.replace(/\/api\/auth\/steam\/callback\/?$/, "").replace(/\/$/, "");
  return new URL(request.url).origin;
}

function safeNickname(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20);
  return cleaned.length >= 3 ? cleaned : `Steam_${value.slice(-8)}`;
}

async function verifySteamOpenId(params: URLSearchParams): Promise<string | null> {
  const claimed = params.get("openid.claimed_id") ?? "";
  const match = claimed.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})\/?$/);
  if (params.get("openid.ns") !== OPENID_NS || params.get("openid.mode") !== "id_res" || !match) return null;

  const verify = new URLSearchParams();
  params.forEach((value, key) => { if (key.startsWith("openid.")) verify.append(key, value); });
  verify.set("openid.mode", "check_authentication");
  const response = await fetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" },
    body: verify.toString(),
    cache: "no-store",
  });
  const text = await response.text();
  return response.ok && /is_valid:\s*true/.test(text) ? match[1] : null;
}

async function getSteamProfile(steamId: string): Promise<SteamProfile> {
  const key = process.env.STEAM_API_KEY?.trim();
  if (key) {
    try {
      const response = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(key)}&steamids=${steamId}`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json() as { response?: { players?: Array<{ personaname?: string; avatarfull?: string }> } };
        const player = data.response?.players?.[0];
        if (player?.personaname) return { nickname: safeNickname(player.personaname), avatarUrl: player.avatarfull ?? null };
      }
    } catch (error) {
      console.error("Steam profile lookup failed", error);
    }
  }
  return { nickname: `Steam_${steamId.slice(-8)}`, avatarUrl: null };
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set({ name: STATE_COOKIE, value: "", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}

function popupResultHtml(origin: string, intent: OAuthIntent, fallbackPath: string, errorCode?: string, isPopup = false) {
  const safeOrigin = JSON.stringify(origin);
  const safeIntent = JSON.stringify(intent);
  const safeFallback = JSON.stringify(fallbackPath);
  const safeIsPopup = JSON.stringify(isPopup);
  const success = !errorCode;
  const message = success
    ? `{type:"duelplay:steam-auth-complete",intent:${safeIntent}}`
    : `{type:"duelplay:steam-auth-error",intent:${safeIntent},code:${JSON.stringify(errorCode)}}`;
  const title = success ? "Вход через Steam выполнен" : "Не удалось завершить вход через Steam";
  const description = success
    ? "Возвращаем тебя на DuelPlay…"
    : "Вернись на DuelPlay и проверь сообщение об ошибке. Если нужно, запусти Steam ещё раз.";
  const linkText = success ? "Продолжить на DuelPlay" : "Вернуться на DuelPlay";
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DuelPlay — Steam</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070b;color:#f7f7fb;font-family:Arial,Helvetica,sans-serif}.card{max-width:420px;margin:20px;padding:28px;border:1px solid #302331;border-radius:20px;background:#111017;text-align:center}.mark{color:#ff75b5;font-weight:800;letter-spacing:.08em}p{color:#aaa7b5;line-height:1.6}a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:10px;background:#ff2f91;color:#190712;font-weight:800;text-decoration:none}</style></head><body><main class="card"><div class="mark">DUELPLAY</div><h1>${title}</h1><p id="status">${description}</p><a id="continue" href="${fallbackPath}" hidden>${linkText}</a></main><script>(function(){const targetOrigin=${safeOrigin};const payload=${message};const fallback=${safeFallback};const isPopup=${safeIsPopup};const status=document.getElementById("status");const link=document.getElementById("continue");let openerNotified=false;let channelAvailable=false;try{if(window.opener&&!window.opener.closed){window.opener.postMessage(payload,targetOrigin);openerNotified=true;}}catch(e){}try{const channel=new BroadcastChannel(${JSON.stringify(STEAM_CHANNEL)});channelAvailable=true;channel.postMessage(payload);channel.close();}catch(e){}if(openerNotified||(isPopup&&channelAvailable)){window.close();window.setTimeout(function(){if(!window.closed){status.textContent="${success ? "Вход подтверждён. Если окно не закрылось автоматически, вернись на DuelPlay." : "Ошибка передана в DuelPlay. Если окно не закрылось автоматически, вернись на исходную вкладку."}";link.hidden=false;}},500);}else{window.location.replace(targetOrigin+fallback);}})();</script></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } });
}

async function getSessionUser(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const raw = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const token = decodeURIComponent(raw);
    return await prisma.userSession.findFirst({
      where: { token: hashToken(token), isRevoked: false, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
  } catch {
    return null;
  }
}

async function linkSteam(userId: string, steamId: string, avatarUrl: string | null, sessionId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const activeSession = await tx.userSession.findFirst({ where: { id: sessionId, userId, isRevoked: false, expiresAt: { gt: new Date() } }, select: { id: true } });
      if (!activeSession) throw new Error("STEAM_LINK_SESSION_CHANGED");
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, steamId: true, steamAvatarUrl: true, status: true, deletedAt: true } });
      if (!user || user.status !== "ACTIVE" || user.deletedAt) throw new Error("ACCOUNT_DISABLED");
      if (user.steamId === steamId) return "already-linked" as const;
      if (user.steamId && user.steamId !== steamId) throw new Error("STEAM_ALREADY_LINKED");
      const owner = await tx.user.findUnique({ where: { steamId }, select: { id: true } });
      if (owner && owner.id !== userId) throw new Error("STEAM_CONFLICT");
      const updated = await tx.user.updateMany({ where: { id: userId, steamId: null }, data: { steamId, steamAvatarUrl: avatarUrl ?? user.steamAvatarUrl } });
      if (updated.count === 1) return "linked" as const;
      const current = await tx.user.findUnique({ where: { id: userId }, select: { steamId: true } });
      if (current?.steamId === steamId) return "already-linked" as const;
      const currentOwner = await tx.user.findUnique({ where: { steamId }, select: { id: true } });
      if (currentOwner && currentOwner.id !== userId) throw new Error("STEAM_CONFLICT");
      throw new Error("STEAM_ALREADY_LINKED");
    });
  } catch (error) {
    // A concurrent account-link request can win the unique steamId constraint.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const owner = await prisma.user.findUnique({ where: { steamId }, select: { id: true } }).catch(() => null);
      if (owner && owner.id !== userId) throw new Error("STEAM_CONFLICT");
      const current = await prisma.user.findUnique({ where: { id: userId }, select: { steamId: true } }).catch(() => null);
      if (current?.steamId === steamId) return "already-linked" as const;
      throw new Error("STEAM_ALREADY_LINKED");
    }
    throw error;
  }
}

async function consumeLinkState(state: string, userId: string, sessionId: string, ipAddress: string) {
  const stateHash = hashToken(state);
  return prisma.$transaction(async (tx) => {
    // Serialize callbacks for a given state so two concurrent replays cannot both pass.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`steam-link-state:${stateHash}`}, 0))`;
    const issued = await tx.securityEvent.findFirst({
      where: {
        eventType: "STEAM_LINK_STATE_ISSUED",
        userId,
        createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
        AND: [
          { metadata: { path: ["stateHash"], equals: stateHash } },
          { metadata: { path: ["sessionId"], equals: sessionId } },
        ],
      },
      select: { id: true },
    });
    if (!issued) return false;

    const consumed = await tx.securityEvent.findFirst({
      where: { eventType: "STEAM_LINK_STATE_CONSUMED", metadata: { path: ["stateHash"], equals: stateHash } },
      select: { id: true },
    });
    if (consumed) return false;

    await tx.securityEvent.create({
      data: { userId, eventType: "STEAM_LINK_STATE_CONSUMED", severity: "INFO", ipAddress, metadata: { stateHash, sessionId } },
    });
    return true;
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = getBaseUrl(request);
  const origin = new URL(baseUrl).origin;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "STEAM_LOGIN_CALLBACK", 20, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      const limitedCookie = request.headers.get("cookie") ?? "";
      const raw = limitedCookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1) ?? "";
      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch {}
      const parts = decoded.split(":");
      const hasIntent = parts[1] === "login" || parts[1] === "link";
      const intent: OAuthIntent = hasIntent ? parts[1] as OAuthIntent : "login";
      const isPopup = hasIntent && parts.at(-1) === "popup";
      const fallback = `${intent === "link" ? "/profile" : "/login"}?error=too_many_attempts`;
      return clearStateCookie(popupResultHtml(origin, intent, fallback, "too_many_attempts", isPopup));
    }
    throw error;
  }

  const cookie = request.headers.get("cookie") ?? "";
  const rawStateCookie = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1) ?? "";
  let stateCookie = "";
  try { stateCookie = decodeURIComponent(rawStateCookie); } catch { stateCookie = rawStateCookie; }
  const stateParts = stateCookie.split(":");
  const expectedState = stateParts[0] ?? "";
  const returnedState = url.searchParams.get("state") ?? "";
  // Accept the prior state:ref cookie format for an OAuth flow already in progress.
  const hasIntent = stateParts[1] === "login" || stateParts[1] === "link";
  const intent: OAuthIntent = hasIntent ? stateParts[1] as OAuthIntent : "login";
  const isPopup = hasIntent && stateParts.at(-1) === "popup";
  const hasTabMarker = hasIntent && stateParts.at(-1) === "tab";
  const rawRef = (hasIntent ? stateParts.slice(2, isPopup || hasTabMarker ? -1 : undefined) : stateParts.slice(1)).join(":") || "";
  let ref = "";
  try { ref = decodeURIComponent(rawRef).toUpperCase(); } catch { ref = ""; }
  const fallbackPath = intent === "link" ? "/profile" : "/";

  if (!expectedState || !returnedState || returnedState !== expectedState) {
    return clearStateCookie(popupResultHtml(origin, intent, `${intent === "link" ? "/profile" : "/login"}?error=steam_state`, "steam_state", isPopup));
  }

  let linkSession: Awaited<ReturnType<typeof getSessionUser>> = null;
  if (intent === "link") {
    linkSession = await getSessionUser(request);
    if (!linkSession) {
      return clearStateCookie(popupResultHtml(origin, intent, "/login?error=steam_link_auth_required", "steam_link_auth_required", isPopup));
    }
    if (!isBoundToSameSession(linkSession.userId, linkSession.id, linkSession.user.id, linkSession.id) || linkSession.user.status !== "ACTIVE" || linkSession.user.deletedAt) {
      return clearStateCookie(popupResultHtml(origin, intent, "/profile?error=steam_link_auth_required", "steam_link_auth_required", isPopup));
    }
  }

  try {
    const steamId = await verifySteamOpenId(url.searchParams);
    if (!steamId) {
      return clearStateCookie(popupResultHtml(origin, intent, `${intent === "link" ? "/profile" : "/login"}?error=steam_verify`, "steam_verify", isPopup));
    }
    if (intent === "link") {
      if (!linkSession) {
        return clearStateCookie(popupResultHtml(origin, intent, "/login?error=steam_link_auth_required", "steam_link_auth_required", isPopup));
      }
      const ipAddress = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const consumed = await consumeLinkState(expectedState, linkSession.userId, linkSession.id, ipAddress);
      if (!consumed) {
        return clearStateCookie(popupResultHtml(origin, intent, "/profile?error=steam_state", "steam_state", isPopup));
      }
    }
    const profile = await getSteamProfile(steamId);

    if (intent === "link") {
      // Re-read the cookie-backed session after the remote Steam verification and
      // bind the database update to that exact session row in the same transaction.
      const currentSession = await getSessionUser(request);
      if (!linkSession || !currentSession || !isBoundToSameSession(linkSession.userId, linkSession.id, currentSession.userId, currentSession.id)) {
        return clearStateCookie(popupResultHtml(origin, intent, "/profile?error=steam_state", "steam_state", isPopup));
      }
      try {
        await linkSteam(linkSession.user.id, steamId, profile.avatarUrl, linkSession.id);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        const errorCode = code === "STEAM_CONFLICT" ? "steam_conflict" : code === "STEAM_ALREADY_LINKED" ? "steam_already_linked" : code === "STEAM_LINK_SESSION_CHANGED" ? "steam_state" : code === "ACCOUNT_DISABLED" ? "account_disabled" : "steam_error";
        return clearStateCookie(popupResultHtml(origin, intent, `/profile?error=${errorCode}`, errorCode, isPopup));
      }
      const response = popupResultHtml(origin, intent, fallbackPath, undefined, isPopup);
      return clearStateCookie(response);
    }

    let user = await prisma.user.findUnique({ where: { steamId } });
    if (!user) {
      let nickname = profile.nickname;
      for (let i = 0; i < 20 && await prisma.user.findUnique({ where: { nickname } }); i++) nickname = `${profile.nickname.slice(0, 16)}_${i + 1}`;
      let referredById: string | undefined;
      if (ref) {
        const referrer = await prisma.user.findUnique({ where: { referralCode: ref }, select: { id: true, status: true, deletedAt: true } });
        if (referrer?.status === "ACTIVE" && !referrer.deletedAt) referredById = referrer.id;
      }
      try {
        user = await prisma.user.create({ data: { steamId, nickname, avatarUrl: null, steamAvatarUrl: profile.avatarUrl, referralCode: `DP${newSessionToken().slice(0, 8).toUpperCase()}`, referredById, wallet: { create: {} } } });
      } catch (error) {
        // Concurrent/replayed callbacks must not create duplicate Steam users.
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          user = await prisma.user.findUnique({ where: { steamId } });
          if (!user) throw error;
        } else {
          throw error;
        }
      }
    } else if (profile.avatarUrl && user.steamAvatarUrl !== profile.avatarUrl) {
      user = await prisma.user.update({ where: { id: user.id }, data: { steamAvatarUrl: profile.avatarUrl } });
    }
    if (user.status !== "ACTIVE" || user.deletedAt) return clearStateCookie(popupResultHtml(origin, intent, "/login?error=account_disabled", "account_disabled", isPopup));

    const token = newSessionToken();
    await prisma.userSession.create({ data: { userId: user.id, token: hashToken(token), ipAddress: "steam", userAgent: request.headers.get("user-agent") ?? "unknown", expiresAt: new Date(Date.now() + 30 * 86400000) } });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const response = popupResultHtml(origin, intent, fallbackPath, undefined, isPopup);
    response.cookies.set({ ...sessionCookieOptions(), value: token });
    return clearStateCookie(response);
  } catch (error) {
    console.error("Steam auth failed", error);
    const response = popupResultHtml(origin, intent, `${intent === "link" ? "/profile" : "/login"}?error=steam_error`, "steam_error", isPopup);
    return clearStateCookie(response);
  }
}
