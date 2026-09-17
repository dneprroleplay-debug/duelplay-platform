export const REFERRAL_RACE_PRIZES = [100, 50, 25] as const;

export function referralRaceMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function referralRaceWindow(monthKey: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) throw new Error("INVALID_MONTH");
  const month = new Date(`${monthKey}-01T00:00:00.000Z`);
  const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  return { month, next };
}

export function rankReferralRace<T extends { invited: number; nickname: string; id: string }>(rows: T[]) {
  return [...rows]
    .sort((a, b) => b.invited - a.invited || a.nickname.localeCompare(b.nickname) || a.id.localeCompare(b.id))
    .map((row, index) => ({ ...row, position: index + 1, prize: index < REFERRAL_RACE_PRIZES.length ? REFERRAL_RACE_PRIZES[index] : 0 }));
}
