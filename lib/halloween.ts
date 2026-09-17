export const HALLOWEEN_EVENT = {
  slug: "halloween",
  name: "Halloween",
  icon: "🎃",
  theme: "HALLOWEEN",
  durationDays: 3,
  effects: { pumpkin: true, ghost: true, particles: true },
  missions: [
    { id: "halloween-wins", name: "Win 5 duels", type: "WINS", target: 5, reward: { xp: 250 } },
    { id: "halloween-matches", name: "Play 10 duels", type: "PLAY_DUELS", target: 10, reward: { xp: 200 } },
    { id: "halloween-cases", name: "Open 3 cases", type: "OPEN_CASE", target: 3, reward: { xp: 150 } },
    { id: "halloween-streak", name: "Reach a 3-win streak", type: "STREAK", target: 3, reward: { xp: 300 } },
  ],
  rewards: [
    { level: 1, free: { xp: 100 } },
    { level: 5, free: { xp: 250 }, premium: { caseSlug: "halloween-case" } },
    { level: 10, free: { xp: 500 }, premium: { cosmetic: true } },
    { level: 15, free: { caseSlug: "halloween-case" }, premium: { xp: 1000 } },
    { level: 20, free: { xp: 750 }, premium: { caseSlug: "halloween-case", cosmetic: true } },
  ],
  eventPass: true,
  premiumPass: true,
  premiumPrice: 19.99,
  promoMultiplier: 1.5,
  caseSlug: "halloween-case",
} as const;

export function halloweenWindow(year: number) {
  const startsAt = new Date(Date.UTC(year, 9, 31, 0, 0, 0));
  const endsAt = new Date(startsAt.getTime() + HALLOWEEN_EVENT.durationDays * 86400000);
  return { startsAt, endsAt };
}

export function isHalloweenEvent(event: { name: string; theme?: string | null; effects?: unknown; missions?: unknown; rewards?: unknown }) {
  return event.name === HALLOWEEN_EVENT.name && event.theme === HALLOWEEN_EVENT.theme;
}
