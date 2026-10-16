export function levelFromXp(xp: number) {
  const safe = Math.max(0, Math.floor(xp));
  return Math.max(0, Math.min(100, Math.floor(Math.sqrt(safe / 100))));
}
