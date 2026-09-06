import { Prisma } from "@prisma/client";
import { grantReward } from "@/lib/rewards";

type Tx = Prisma.TransactionClient;

export const EVENT_PASS_XP_PER_LEVEL = 100;

export function eventPassLevelForXp(xp: number, maxLevel = 20) {
  const safe = Math.max(0, Math.floor(Number(xp) || 0));
  return Math.min(Math.max(1, Math.floor(Number(maxLevel) || 1)), Math.floor(safe / EVENT_PASS_XP_PER_LEVEL) + 1);
}

export function eventPassProgress(xp: number, maxLevel = 20) {
  const safe = Math.max(0, Math.floor(Number(xp) || 0));
  const level = eventPassLevelForXp(safe, maxLevel);
  if (level >= maxLevel) return { level, xp: safe, currentXp: EVENT_PASS_XP_PER_LEVEL, nextLevelXp: EVENT_PASS_XP_PER_LEVEL, percent: 100 };
  const currentXp = safe % EVENT_PASS_XP_PER_LEVEL;
  return { level, xp: safe, currentXp, nextLevelXp: EVENT_PASS_XP_PER_LEVEL, percent: currentXp };
}

function missionList(event: { missions?: unknown }) {
  return Array.isArray(event.missions) ? event.missions.filter((m: any) => m && typeof m === "object") as any[] : [];
}

export async function awardEventPassXp(tx: Tx, userId: string, eventId: string, amount: number) {
  const gain = Math.max(0, Math.floor(Number(amount) || 0));
  if (!gain) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:event-pass'))`;
  const pass = await tx.eventPass.findUnique({ where: { eventId_userId: { eventId, userId } } });
  if (!pass) return null;
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { startsAt: true, endsAt: true, status: true } });
  if (!event || event.status === "CANCELLED" || event.status === "DRAFT" || event.startsAt > new Date() || event.endsAt <= new Date()) return null;
  const nextXp = pass.xp + gain;
  const nextLevel = eventPassLevelForXp(nextXp, 20);
  return tx.eventPass.update({ where: { id: pass.id }, data: { xp: nextXp, level: Math.max(pass.level, nextLevel) } });
}

export async function updateEventMissionProgress(tx: Tx, userId: string, eventId: string, stats: { totalDuels: number; wins: number; bestStreak: number; casesOpened: number }) {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { startsAt: true, endsAt: true, status: true, missions: true } });
  if (!event || event.status === "CANCELLED" || event.status === "DRAFT") return [];
  const now = new Date();
  if (event.startsAt > now || event.endsAt <= now) return [];
  const missions = missionList(event);
  const completed: any[] = [];
  for (const mission of missions) {
    const target = Math.max(1, Math.floor(Number(mission.target) || 0));
    if (!target || typeof mission.id !== "string") continue;
    let value = 0;
    if (mission.type === "PLAY_DUELS") value = stats.totalDuels;
    else if (mission.type === "WINS") value = stats.wins;
    else if (mission.type === "STREAK") value = stats.bestStreak;
    else if (mission.type === "OPEN_CASE") value = stats.casesOpened;
    value = Math.min(target, Math.max(0, Math.floor(value)));
    const row = await tx.eventMissionProgress.upsert({
      where: { eventId_userId_missionId: { eventId, userId, missionId: mission.id } },
      update: { progress: value, completed: value >= target },
      create: { eventId, userId, missionId: mission.id, progress: value, completed: value >= target },
    });
    if (row.completed && value >= target) completed.push(mission);
  }
  for (const mission of completed) {
    const reward = mission.reward && typeof mission.reward === "object" ? mission.reward : {};
    const key = `event-mission:${eventId}:${userId}:${mission.id}`;
    const grant = await grantReward(tx, userId, reward, key, `Event mission · ${String(mission.name || mission.id)}`, eventId);
    const rewardXp = Math.max(0, Math.floor(Number((reward as any).xp) || 0));
    if (!grant.idempotent && rewardXp > 0) await awardEventPassXp(tx, userId, eventId, rewardXp);
  }
  return completed;
}

export async function refreshEventMissionsForUser(tx: Tx, userId: string, eventId: string) {
  const stats = await tx.playerStats.findUnique({ where: { userId }, select: { totalDuels: true, wins: true, bestStreak: true } });
  const casesOpened = await tx.caseOpening.count({ where: { userId, status: "COMPLETED", completedAt: { not: null } } });
  return updateEventMissionProgress(tx, userId, eventId, {
    totalDuels: Number(stats?.totalDuels || 0), wins: Number(stats?.wins || 0), bestStreak: Number(stats?.bestStreak || 0), casesOpened,
  });
}
