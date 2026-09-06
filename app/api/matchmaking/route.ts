import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { debitWallet } from "@/lib/wallet";
import { getFeatureFlag, getPlatformNumber } from "@/lib/platform-settings";
import { deadlineFromNow, MATCH_START_TIMEOUT_MS } from "@/lib/match-timers";
import { DUEL_MODE_IDS, isDuelMode, type DuelModeId } from "@/lib/duel-modes";

const DEFAULT_STAKE = 3;
const STAKE_TOLERANCE = 0.10;
const DEFAULT_RATING_WINDOW = 200;
const MIN_RATING_WINDOW = 25;
const MAX_RATING_WINDOW = 500;
const MAX_CANDIDATES = 100;
const RETURN_CANDIDATES = 10;
const ALLOWED_MODES = DUEL_MODE_IDS;
type AllowedMode = DuelModeId;

type Candidate = {
  id: string;
  playerOneId: string;
  betAmount: unknown;
  mapName: string | null;
  commission: unknown;
  format: string;
  weaponModifier: string | null;
  createdAt: Date;
  playerOne: { id: string; nickname: string; status: string; playerStats: { rating: number } | null };
};

function numberParam(value: string | null, fallback: number) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRatingWindow(value: number) {
  return Math.min(MAX_RATING_WINDOW, Math.max(MIN_RATING_WINDOW, value));
}

function serializeCandidate(x: Candidate, ownRating: number, requestedStake: number) {
  const rating = Number(x.playerOne.playerStats?.rating ?? 1000);
  const stake = Number(x.betAmount);
  return {
    id: x.id,
    playerOneId: x.playerOneId,
    nickname: x.playerOne.nickname,
    mapName: x.mapName,
    format: x.format,
    weaponModifier: x.weaponModifier,
    betAmount: stake,
    rating,
    ratingDifference: Math.abs(rating - ownRating),
    stakeDifference: Math.abs(stake - requestedStake),
    createdAt: x.createdAt,
  };
}

async function findCandidates({
  tx,
  meId,
  mode,
  requestedStake,
  rating,
  ratingWindow,
  mapName,
}: {
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  meId: string;
  mode: AllowedMode;
  requestedStake: number;
  rating: number;
  ratingWindow: number;
  mapName: string | null;
}) {
  const stakeMin = requestedStake * (1 - STAKE_TOLERANCE);
  const stakeMax = requestedStake * (1 + STAKE_TOLERANCE);

  const rows = await tx.match.findMany({
    where: {
      status: "WAITING_FOR_PLAYERS",
      mode,
      playerTwoId: null,
      playerOneId: { not: meId },
      betAmount: { gte: stakeMin, lte: stakeMax },
      ...(mapName ? { mapName } : {}),
    },
    select: {
      id: true,
      playerOneId: true,
      betAmount: true,
      mapName: true,
      commission: true,
      format: true,
      weaponModifier: true,
      createdAt: true,
      playerOne: {
        select: {
          id: true,
          nickname: true,
          status: true,
          playerStats: { select: { rating: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_CANDIDATES,
  });

  return rows
    .filter((x) => x.playerOne.status === "ACTIVE")
    .filter((x) => Math.abs(Number(x.playerOne.playerStats?.rating ?? 1000) - rating) <= ratingWindow)
    .sort((a, b) => {
      const ratingDiffA = Math.abs(Number(a.playerOne.playerStats?.rating ?? 1000) - rating);
      const ratingDiffB = Math.abs(Number(b.playerOne.playerStats?.rating ?? 1000) - rating);
      if (ratingDiffA !== ratingDiffB) return ratingDiffA - ratingDiffB;
      const stakeDiffA = Math.abs(Number(a.betAmount) - requestedStake);
      const stakeDiffB = Math.abs(Number(b.betAmount) - requestedStake);
      if (stakeDiffA !== stakeDiffB) return stakeDiffA - stakeDiffB;
      return a.createdAt.getTime() - b.createdAt.getTime();
    }) as Candidate[];
}

export async function GET(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await getFeatureFlag("MATCHMAKING", true))) return NextResponse.json({ error: "Matchmaking is temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });

  const modeValue = request.nextUrl.searchParams.get("mode") || "SOLO_1V1";
  if (!isDuelMode(modeValue)) return NextResponse.json({ error: "Invalid mode" }, { status: 400 });

  const minStake = await getPlatformNumber("MIN_STAKE", DEFAULT_STAKE);
  const requestedStake = numberParam(request.nextUrl.searchParams.get("stake"), minStake);
  if (!Number.isFinite(requestedStake) || requestedStake < minStake) return NextResponse.json({ error: `Stake must be at least $${minStake}`, errorCode: "INVALID_STAKE" }, { status: 400 });

  const ratingWindow = normalizeRatingWindow(numberParam(request.nextUrl.searchParams.get("ratingWindow"), DEFAULT_RATING_WINDOW));
  const mapName = request.nextUrl.searchParams.get("mapName") || null;
  const ownStats = await prisma.playerStats.findUnique({ where: { userId: me.id }, select: { rating: true } });
  const rating = Number(ownStats?.rating ?? 1000);
  const candidates = await prisma.$transaction((tx) => findCandidates({ tx, meId: me.id, mode: modeValue as AllowedMode, requestedStake, rating, ratingWindow, mapName }));

  return NextResponse.json({
    mode: modeValue,
    requestedStake,
    rating,
    ratingWindow,
    stakeTolerancePercent: STAKE_TOLERANCE * 100,
    candidates: candidates.slice(0, RETURN_CANDIDATES).map((x) => serializeCandidate(x, rating, requestedStake)),
  });
}

export async function POST(request: NextRequest) {
  try {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await getFeatureFlag("MATCHMAKING", true))) return NextResponse.json({ error: "Matchmaking is temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });

    let body: { mode?: unknown; stake?: unknown; ratingWindow?: unknown; mapName?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

    const mode = String(body.mode || "SOLO_1V1") as AllowedMode;
    if (!isDuelMode(mode)) return NextResponse.json({ error: "Invalid mode" }, { status: 400 });

    const minStake = await getPlatformNumber("MIN_STAKE", DEFAULT_STAKE);
    const maxStake = await getPlatformNumber("MAX_STAKE", 10_000);
    const requestedStake = Number(body.stake ?? minStake);
    if (!Number.isFinite(requestedStake) || requestedStake < minStake || requestedStake > maxStake) return NextResponse.json({ error: `Stake must be between $${minStake} and $${maxStake}`, errorCode: "INVALID_STAKE" }, { status: 400 });

    const ratingWindow = normalizeRatingWindow(Number.isFinite(Number(body.ratingWindow)) ? Number(body.ratingWindow) : DEFAULT_RATING_WINDOW);
    const mapName = body.mapName ? String(body.mapName) : null;

    const result = await prisma.$transaction(async (tx) => {
      // Serialize automatic claims so two simultaneous searches cannot select the same open duel.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:matchmaking-claim'))`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${me.id}::uuid FOR UPDATE`;

      const busy = await tx.match.findFirst({
        where: { status: { in: ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE"] }, OR: [{ playerOneId: me.id }, { playerTwoId: me.id }] },
        select: { id: true },
      });
      if (busy) throw new Error("PLAYER_BUSY");

      const ownStats = await tx.playerStats.findUnique({ where: { userId: me.id }, select: { rating: true } });
      const rating = Number(ownStats?.rating ?? 1000);
      const candidates = await findCandidates({ tx, meId: me.id, mode, requestedStake, rating, ratingWindow, mapName });

      for (const candidate of candidates) {
        const candidateBusy = await tx.match.findFirst({
          where: { status: { in: ["READY", "STARTING", "LIVE"] }, OR: [{ playerOneId: candidate.playerOneId }, { playerTwoId: candidate.playerOneId }] },
          select: { id: true },
        });
        if (candidateBusy) continue;

        const claimed = await tx.match.updateMany({
          where: { id: candidate.id, status: "WAITING_FOR_PLAYERS", playerTwoId: null },
          data: { playerTwoId: me.id, status: "READY", startDeadlineAt: deadlineFromNow(MATCH_START_TIMEOUT_MS) },
        });
        if (claimed.count !== 1) continue;

        const amount = Number(candidate.betAmount);
        const debit = await debitWallet(tx, me.id, amount, `match:${candidate.id}:player2`, "MATCH_BET", `Ставка на CS2 · ${candidate.mapName || "Duel"}`, candidate.id);
        if (debit.idempotent) throw new Error("ALREADY_JOINED");

        const walletRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Wallet" WHERE "userId" = ${me.id}::uuid FOR UPDATE`;
        const wallet = walletRows[0];
        if (!wallet) throw new Error("WALLET_NOT_FOUND");
        await tx.wallet.update({ where: { id: wallet.id }, data: { lockedBalance: { increment: amount } } });

        await tx.notification.create({
          data: {
            userId: candidate.playerOneId,
            type: "MATCH_FOUND",
            status: "UNREAD",
            title: "Match found",
            body: `${me.nickname} joined your duel.`,
            payload: { matchId: candidate.id, kind: "MATCHMAKING_FOUND" },
          },
        });

        const match = await tx.match.findUniqueOrThrow({ where: { id: candidate.id } });
        return { match, joined: true, rating, requestedStake, ratingWindow };
      }

      return { match: null, joined: false, rating, requestedStake, ratingWindow };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PLAYER_BUSY") return NextResponse.json({ error: "You already have an active match", errorCode: "PLAYER_BUSY" }, { status: 409 });
    if (code === "ALREADY_JOINED") return NextResponse.json({ error: "Already joined this match", errorCode: "ALREADY_JOINED" }, { status: 409 });
    if (code === "INSUFFICIENT_BALANCE") return NextResponse.json({ error: "Insufficient balance", errorCode: "INSUFFICIENT_BALANCE" }, { status: 400 });
    if (code === "WALLET_NOT_FOUND") return NextResponse.json({ error: "Wallet not found", errorCode: "WALLET_NOT_FOUND" }, { status: 409 });
    console.error("matchmaking failed", error);
    return NextResponse.json({ error: "Matchmaking failed" }, { status: 500 });
  }
}
