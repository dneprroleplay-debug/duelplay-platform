import { prisma } from "@/lib/prisma";
import { chooseEffectiveSeason, type SeasonCandidate } from "@/lib/season-policy";

export type SeasonView = {
  id: string | null;
  name: string;
  theme: string;
  effects: unknown;
  mode: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

const seasonSelect = {
  id: true, name: true, theme: true, startsAt: true, endsAt: true,
  mode: true, effects: true, active: true, createdAt: true,
} as const;

export async function getActiveSeason(now = new Date()): Promise<SeasonView> {
  const seasons = await prisma.season.findMany({
    where: {
      mode: { in: ["AUTO", "MANUAL"] },
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: seasonSelect,
  });
  const active = chooseEffectiveSeason(seasons as SeasonCandidate[], now);
  if (!active) {
    return { id: null, name: "DuelPlay", theme: "default", effects: null, mode: "OFF", active: false, startsAt: null, endsAt: null };
  }
  return {
    id: active.id,
    name: active.name,
    theme: active.theme,
    effects: active.effects,
    mode: active.mode,
    active: true,
    startsAt: active.startsAt.toISOString(),
    endsAt: active.endsAt.toISOString(),
  };
}
