import { NextRequest, NextResponse } from "next/server";
import { getFeatureFlag } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { debitWallet, creditWallet } from "@/lib/wallet";
import { grantReward } from "@/lib/rewards";

function rewardAt(rewards: unknown, level: number, premium: boolean) {
  if (!Array.isArray(rewards)) return null;
  const row = rewards.find((x: any) => Number(x?.level) === level);
  if (!row) return null;
  return premium ? (row.premium ?? row.free ?? row.reward ?? null) : (row.free ?? row.reward ?? null);
}
function rewardValue(reward: unknown) {
  if (!reward || typeof reward !== "object") return { xp: 0, balance: 0 };
  const r = reward as Record<string, unknown>;
  return { xp: Math.max(0, Math.floor(Number(r.xp || 0))), balance: Math.max(0, Number(r.balance || r.coins || 0)) };
}

async function activePass() {
  const now = new Date();
  return prisma.duelPass.findFirst({ where: { active: true, startsAt: { lte: now }, endsAt: { gte: now } }, orderBy: { createdAt: "desc" } });
}
export async function GET() {
  if (!(await getFeatureFlag("DUELPASS", false))) return NextResponse.json({ error: "DuelPass is temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  const me = await getCurrentUser(); if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const pass = await activePass(); if (!pass) return NextResponse.json({ pass: null });
  const progress = await prisma.duelPassProgress.upsert({ where: { passId_userId: { passId: pass.id, userId: me.id } }, update: {}, create: { passId: pass.id, userId: me.id, level: 1, xp: 0 } });
  const rewards = Array.isArray(pass.rewards) ? pass.rewards : [];
  const claims = await prisma.duelPassClaim.findMany({ where: { passId: pass.id, userId: me.id }, select: { level: true } });
  return NextResponse.json({ pass, progress, rewards, claimedLevels: claims.map((x) => x.level), currentReward: rewardAt(pass.rewards, progress.level, progress.premium) });
}
export async function POST(r: NextRequest) {
  if (!(await getFeatureFlag("DUELPASS", false))) return NextResponse.json({ error: "DuelPass is temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  const me = await getCurrentUser(); if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await r.json().catch(() => ({})); const action = String(b.action || ""); const pass = await activePass();
  if (!pass) return NextResponse.json({ error: "No active pass" }, { status: 404 });
  try {
    if (action === "premium") {
      const idem = String(r.headers.get("idempotency-key") || `duelpass:${pass.id}:${me.id}:premium`);
      const out = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:duelpass'))`;
        const current = await tx.duelPassProgress.upsert({ where: { passId_userId: { passId: pass.id, userId: me.id } }, update: {}, create: { passId: pass.id, userId: me.id, level: 1, xp: 0 } });
        if (current.premium) return current;
        if (Number(pass.premiumPrice) > 0) await debitWallet(tx, me.id, Number(pass.premiumPrice), `duelpass:${idem}`, "DUELPASS_PURCHASE", `DuelPass Premium · ${pass.name}`);
        return tx.duelPassProgress.update({ where: { id: current.id }, data: { premium: true } });
      });
      return NextResponse.json(out);
    }
    if (action === "claim") {
      const requestedLevel = Number(b.level);
      if (!Number.isInteger(requestedLevel) || requestedLevel < 1 || requestedLevel > pass.maxLevel) throw new Error("INVALID_LEVEL");
      const level = requestedLevel;
      const idem = String(r.headers.get("idempotency-key") || `duelpass:${pass.id}:${me.id}:claim:${level}`);
      const out = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:duelpass'))`;
        const current = await tx.duelPassProgress.upsert({ where: { passId_userId: { passId: pass.id, userId: me.id } }, update: {}, create: { passId: pass.id, userId: me.id, level: 1, xp: 0 } });
        if (current.level < level) throw new Error("LEVEL_LOCKED");
        const rawReward = rewardAt(pass.rewards, level, current.premium);
        const reward = rewardValue(rawReward);
        const hasItemReward = !!(rawReward && typeof rawReward === "object" && (((rawReward as any).case) || (rawReward as any).caseId || (rawReward as any).caseSlug || (rawReward as any).cosmetic || (rawReward as any).cosmeticItemId));
        if (!reward.xp && !reward.balance && !hasItemReward) throw new Error("NO_REWARD");
        const marker = `duelpass-claim:${idem}`;
        const existing = await tx.duelPassClaim.findUnique({ where: { passId_userId_level: { passId: pass.id, userId: me.id, level } } });
        if (existing) return { idempotent: true, balance: null, reward };
        const granted = await grantReward(tx, me.id, rawReward, marker, `DuelPass reward · ${pass.name} · ${level}`, pass.id);
        const balance = granted.balanceAfter;
        await tx.duelPassClaim.create({ data: { passId: pass.id, userId: me.id, level } });
        return { idempotent: false, balance, reward };
      });
      return NextResponse.json({ ok: true, ...out });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const status = message === "LEVEL_LOCKED" || message === "NO_REWARD" || message === "INSUFFICIENT_BALANCE" || message === "INVALID_LEVEL" ? 409 : 500;
    return NextResponse.json({ error: message === "LEVEL_LOCKED" ? "Level is not unlocked" : message === "NO_REWARD" ? "No reward configured" : message === "INSUFFICIENT_BALANCE" ? "Insufficient balance" : message === "INVALID_LEVEL" ? "Invalid level" : "Could not process DuelPass" }, { status });
  }
}
