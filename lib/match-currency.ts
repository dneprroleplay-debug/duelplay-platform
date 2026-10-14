export type MatchEconomyMode = "REAL" | "DEMO";

export function formatMatchAmount(economyMode: MatchEconomyMode, amount: number | string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new TypeError("Match amount must be a finite number");
  return economyMode === "DEMO" ? `DC ${value.toFixed(2)}` : `$${value.toFixed(2)}`;
}

export function getMatchDisplayTotals(
  stake: number | string,
  savedCommission: number | string,
  hasSecondPlayer: boolean,
  waitingForSecondPlayer = !hasSecondPlayer,
) {
  const perPlayerStake = Number(stake);
  const commission = Number(savedCommission);
  if (!Number.isFinite(perPlayerStake) || perPlayerStake < 0 || !Number.isFinite(commission) || commission < 0) {
    throw new TypeError("Match stake and saved commission must be finite non-negative numbers");
  }

  const currentBank = perPlayerStake * (hasSecondPlayer ? 2 : 1);
  const fullBank = perPlayerStake * 2;
  const payoutBank = waitingForSecondPlayer ? fullBank : currentBank;
  return {
    currentBank,
    fullBank,
    commission,
    winnerPayout: payoutBank - commission,
  };
}
