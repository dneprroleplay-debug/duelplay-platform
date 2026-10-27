export type SettlementHoldEvidence = {
  userId: string;
  amount: string | number;
  status: "ACTIVE" | "RELEASED" | "CONSUMED" | string;
};

export type SettlementEvidence = {
  holds: SettlementHoldEvidence[];
  expectedUsers: readonly [string, string];
  stake: string | number;
  hasWinnerPayout: boolean;
  hasCommission: boolean;
  hasStakeRelease: boolean;
};

/**
 * Classifies the financial state from ledger/hold evidence, never from Match.status.
 * INCONSISTENT means the route must stop for manual review without changing money.
 */
function normalizeAmount(value: string | number): string {
  const raw = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw;
  const sign = match[1] === "-" ? "-" : "";
  const integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

export function classifySettlementEvidence(input: SettlementEvidence): "UNSETTLED" | "SETTLED" | "INCONSISTENT" {
  const hasSettlementEvidence = input.hasWinnerPayout || input.hasCommission || input.hasStakeRelease ||
    input.holds.some((hold) => hold.status !== "ACTIVE");
  if (hasSettlementEvidence) return "SETTLED";

  const expected = [...input.expectedUsers].sort();
  const actual = input.holds.map((hold) => hold.userId).sort();
  const exactActiveHolds = input.holds.length === 2 &&
    actual[0] === expected[0] && actual[1] === expected[1] &&
    input.holds.every((hold) => hold.status === "ACTIVE" && normalizeAmount(hold.amount) === normalizeAmount(input.stake));
  return exactActiveHolds ? "UNSETTLED" : "INCONSISTENT";
}
