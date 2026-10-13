import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const DEMO_STARTER_CREDITS = new Prisma.Decimal("10000.0000");
const STARTER_GRANT_KEY = "demo:starter-grant:v1";

export type DemoTransactionType =
  | "STARTER_GRANT"
  | "MATCH_STAKE"
  | "MATCH_STAKE_LOCK"
  | "MATCH_STAKE_RELEASE"
  | "MATCH_REFUND"
  | "MATCH_WIN"
  | "MATCH_FEE"
  | "MATCH_FEE_ADJUSTMENT"
  | "DISPUTE_ADJUSTMENT"
  | "DEBT_ADJUSTMENT"
  | "BALANCE_ADJUSTMENT";
export type DemoHoldStatus = "ACTIVE" | "RELEASED" | "CONSUMED";
export type DemoAmount = string | Prisma.Decimal;

type DemoWalletRow = {
  id: string;
  userId: string;
  balance: Prisma.Decimal;
  lockedBalance: Prisma.Decimal;
  debtBalance: Prisma.Decimal;
};
type DemoTransactionRow = {
  id: string;
  walletId: string | null;
  userId: string | null;
  matchId: string | null;
  type: DemoTransactionType;
  amount: Prisma.Decimal;
  balanceBefore: Prisma.Decimal | null;
  balanceAfter: Prisma.Decimal | null;
  idempotencyKey: string;
  metadata?: Prisma.JsonValue | null;
};
type DemoWalletHoldRow = {
  id: string;
  walletId: string;
  matchId: string;
  amount: Prisma.Decimal;
  status: DemoHoldStatus;
  idempotencyKey: string;
  closedAt: Date | null;
};

// Keep this local until the generated Prisma client is regenerated from the
// approved additive DEMO schema. Callers never receive an arbitrary client.
type DemoWalletTx = Prisma.TransactionClient & {
  match: {
    findUnique(args: { where: { id: string }; select: { economyMode: true } }): Promise<{ economyMode: "REAL" | "DEMO" } | null>;
  };
  demoWallet: {
    findUnique(args: { where: { userId: string } }): Promise<DemoWalletRow | null>;
    update(args: { where: { id: string }; data: { balance?: Prisma.Decimal; lockedBalance?: Prisma.Decimal; debtBalance?: Prisma.Decimal } }): Promise<DemoWalletRow>;
  };
  demoTransaction: {
    findUnique(args: { where: { idempotencyKey: string } }): Promise<DemoTransactionRow | null>;
    createMany(args: { data: Array<Omit<DemoTransactionRow, "id"> & { description?: string }>; skipDuplicates: true }): Promise<{ count: number }>;
    findFirst(args: { where: { idempotencyKey: string } }): Promise<DemoTransactionRow | null>;
    findMany(args: { where: { matchId: string; type: "MATCH_WIN" | "MATCH_FEE" } }): Promise<DemoTransactionRow[]>;
    create(args: { data: Omit<DemoTransactionRow, "id"> & { description?: string } }): Promise<DemoTransactionRow>;
  };
  demoWalletHold: {
    findUnique(args: { where: { idempotencyKey: string } }): Promise<DemoWalletHoldRow | null>;
    findFirst(args: { where: { walletId: string; matchId: string } }): Promise<DemoWalletHoldRow | null>;
    findMany(args: { where: { walletId: { in: string[] }; matchId: string } }): Promise<DemoWalletHoldRow[]>;
    create(args: { data: Omit<DemoWalletHoldRow, "id" | "closedAt"> & { closedAt?: Date | null } }): Promise<DemoWalletHoldRow>;
    updateMany(args: {
      where: { id: string; status: "ACTIVE"; amount: Prisma.Decimal };
      data: { status: Exclude<DemoHoldStatus, "ACTIVE">; closedAt: Date };
    }): Promise<{ count: number }>;
  };
};

type DemoWalletOperations = {
  getOrCreateDemoWallet(userId: string): ReturnType<typeof getOrCreateDemoWalletInTransaction>;
  grantDemoStarterCredits(userId: string): ReturnType<typeof grantDemoStarterCreditsInTransaction>;
  creditDemoCredits(userId: string, amount: DemoAmount, idempotencyKey: string, type: "MATCH_WIN", matchId: string, description?: string): ReturnType<typeof creditDemoCreditsInTransaction>;
  adjustDemoCredits(userId: string, signedAmount: DemoAmount, idempotencyKey: string, description: string): ReturnType<typeof adjustDemoCreditsInTransaction>;
  reserveDemoStake(userId: string, matchId: string, amount: DemoAmount, debitIdempotencyKey: string, holdIdempotencyKey: string): ReturnType<typeof reserveDemoStakeInTransaction>;
  closeDemoWalletHold(userId: string, matchId: string, amount: DemoAmount, idempotencyKey: string, finalStatus: "RELEASED" | "CONSUMED"): ReturnType<typeof closeDemoWalletHoldInTransaction>;
  recordDemoMatchFee(matchId: string, amount: DemoAmount, idempotencyKey: string): ReturnType<typeof recordDemoMatchFeeInTransaction>;
  resolveDemoDispute(matchId: string, disputeId: string, decision: "DRAW" | "WINNER_PLAYER_ONE" | "WINNER_PLAYER_TWO" | "CANCELLED_REFUND", winnerId: string | null, stake: DemoAmount, fee: DemoAmount): ReturnType<typeof resolveDemoDisputeInTransaction>;
};

type DemoTransactionContext = {
  /** The real interactive Prisma transaction; use it for Match changes in the same atomic unit. */
  db: DemoWalletTx;
  /** DEMO mutations bound to db; do not retain or call after the callback returns. */
  demo: DemoWalletOperations;
};

const transactionScope = new AsyncLocalStorage<{ token: symbol; active: boolean }>();

function decimal(value: DemoAmount): Prisma.Decimal {
  if (typeof (value as unknown) === "number") throw new Error("INVALID_AMOUNT");
  const result = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  if (!result.isFinite() || result.decimalPlaces() > 4) throw new Error("INVALID_AMOUNT");
  return result;
}

function positiveAmount(value: DemoAmount): Prisma.Decimal {
  const result = decimal(value);
  if (result.lte(0)) throw new Error("INVALID_AMOUNT");
  return result;
}

function requireKey(key: string) {
  if (typeof key !== "string" || !key.trim()) throw new Error("IDEMPOTENCY_REQUIRED");
}

async function assertDemoMatch(tx: DemoWalletTx, matchId: string) {
  const match = await tx.match.findUnique({ where: { id: matchId }, select: { economyMode: true } });
  if (!match) throw new Error("MATCH_NOT_FOUND");
  if (match.economyMode !== "DEMO") throw new Error("REAL_MATCH_FORBIDDEN");
}

function sameTransaction(
  row: DemoTransactionRow,
  expected: { walletId: string; userId: string; type: DemoTransactionType; amount: Prisma.Decimal; matchId?: string },
) {
  if (
    row.walletId !== expected.walletId || row.userId !== expected.userId || row.type !== expected.type ||
    !row.amount.eq(expected.amount) || (row.matchId ?? null) !== (expected.matchId ?? null)
  ) throw new Error("IDEMPOTENCY_CONFLICT");
}

async function ensureWallet(tx: DemoWalletTx, userId: string) {
  if (!userId) throw new Error("USER_REQUIRED");
  await tx.$executeRaw`
    INSERT INTO "DemoWallet" ("userId", "balance", "lockedBalance", "debtBalance", "updatedAt")
    VALUES (${userId}::uuid, 0.0000, 0.0000, 0.0000, NOW())
    ON CONFLICT ("userId") DO NOTHING
  `;
  const wallet = await tx.demoWallet.findUnique({ where: { userId } });
  if (!wallet) throw new Error("DEMO_WALLET_NOT_FOUND");
  return wallet;
}

async function lockDemoWalletRow(tx: DemoWalletTx, userId: string) {
  await ensureWallet(tx, userId);
  const rows = await tx.$queryRaw<DemoWalletRow[]>`
    SELECT "id", "userId", "balance", "lockedBalance", "debtBalance"
    FROM "DemoWallet"
    WHERE "userId" = ${userId}::uuid
    FOR UPDATE
  `;
  if (!rows[0]) throw new Error("DEMO_WALLET_NOT_FOUND");
  return rows[0];
}

async function existingForWallet(
  tx: DemoWalletTx,
  idempotencyKey: string,
  expected: { walletId: string; userId: string; type: DemoTransactionType; amount: Prisma.Decimal; matchId?: string },
) {
  const row = await tx.demoTransaction.findUnique({ where: { idempotencyKey } });
  if (!row) return null;
  sameTransaction(row, expected);
  return row;
}

async function appendWalletTransaction(
  tx: DemoWalletTx,
  input: {
    wallet: DemoWalletRow;
    balanceBefore: Prisma.Decimal;
    balanceAfter: Prisma.Decimal;
    amount: Prisma.Decimal;
    type: DemoTransactionType;
    idempotencyKey: string;
    matchId?: string;
    description?: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  return tx.demoTransaction.create({
    data: {
      walletId: input.wallet.id,
      userId: input.wallet.userId,
      matchId: input.matchId ?? null,
      type: input.type,
      amount: input.amount,
      balanceBefore: input.balanceBefore,
      balanceAfter: input.balanceAfter,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      metadata: input.metadata,
    },
  });
}

async function getOrCreateDemoWalletInTransaction(tx: DemoWalletTx, userId: string) {
  return ensureWallet(tx, userId);
}

async function creditWithDebtPriority(
  tx: DemoWalletTx,
  wallet: DemoWalletRow,
  grossAmount: Prisma.Decimal,
  idempotencyKey: string,
  type: "STARTER_GRANT" | "MATCH_WIN" | "MATCH_REFUND" | "BALANCE_ADJUSTMENT",
  matchId?: string,
  description?: string,
) {
  const existing = await tx.demoTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) {
    const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? existing.metadata as Record<string, unknown>
      : null;
    const originalAmount = metadata?.grossAmount === undefined
      ? existing.amount
      : new Prisma.Decimal(String(metadata.grossAmount));
    if (existing.walletId !== wallet.id || existing.userId !== wallet.userId || existing.matchId !== (matchId ?? null)
      || existing.type !== type || !originalAmount.eq(grossAmount)) throw new Error("IDEMPOTENCY_CONFLICT");
    return { idempotent: true, transaction: existing, wallet };
  }

  const debtOffset = Prisma.Decimal.min(wallet.debtBalance, grossAmount).toDecimalPlaces(4);
  const credited = grossAmount.minus(debtOffset).toDecimalPlaces(4);
  const balanceAfter = wallet.balance.plus(credited).toDecimalPlaces(4);
  const debtAfter = wallet.debtBalance.minus(debtOffset).toDecimalPlaces(4);
  const updatedWallet = await tx.demoWallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter, debtBalance: debtAfter } });

  if (debtOffset.gt(0)) {
    await appendWalletTransaction(tx, {
      wallet, balanceBefore: wallet.balance, balanceAfter: wallet.balance,
      amount: debtOffset.negated(), type: "DEBT_ADJUSTMENT",
      idempotencyKey: `${idempotencyKey}:debt-repayment`, matchId,
      description: "DEMO virtual debt repaid from incoming credits",
      metadata: { grossAmount: grossAmount.toFixed(4), sourceKey: idempotencyKey },
    });
  }
  const transaction = await appendWalletTransaction(tx, {
    wallet, balanceBefore: wallet.balance, balanceAfter, amount: credited,
    type, idempotencyKey, matchId, description,
    metadata: { grossAmount: grossAmount.toFixed(4), debtOffset: debtOffset.toFixed(4) },
  });
  return { idempotent: false, transaction, wallet: updatedWallet };
}

async function grantDemoStarterCreditsInTransaction(tx: DemoWalletTx, userId: string) {
  const wallet = await lockDemoWalletRow(tx, userId);
  const idempotencyKey = `${STARTER_GRANT_KEY}:${userId}`;
  return creditWithDebtPriority(tx, wallet, DEMO_STARTER_CREDITS, idempotencyKey, "STARTER_GRANT", undefined, "One-time DEMO starter credits");
}

async function debitDemoCreditsInTransaction(
  tx: DemoWalletTx, userId: string, amount: DemoAmount, idempotencyKey: string, matchId: string, description?: string,
) {
  requireKey(idempotencyKey);
  if (!matchId) throw new Error("MATCH_REQUIRED");
  await assertDemoMatch(tx, matchId);
  const value = positiveAmount(amount);
  const wallet = await lockDemoWalletRow(tx, userId);
  const signedAmount = value.negated();
  const existing = await existingForWallet(tx, idempotencyKey, {
    walletId: wallet.id, userId, type: "MATCH_STAKE", amount: signedAmount, matchId,
  });
  if (existing) return { idempotent: true, transaction: existing, wallet };
  if (wallet.balance.lt(value)) throw new Error("INSUFFICIENT_DEMO_BALANCE");

  const after = wallet.balance.minus(value).toDecimalPlaces(4);
  const updatedWallet = await tx.demoWallet.update({ where: { id: wallet.id }, data: { balance: after } });
  const transaction = await appendWalletTransaction(tx, {
    wallet, balanceBefore: wallet.balance, balanceAfter: after, amount: signedAmount,
    type: "MATCH_STAKE", idempotencyKey, matchId, description,
  });
  return { idempotent: false, transaction, wallet: updatedWallet };
}

async function creditDemoCreditsInTransaction(
  tx: DemoWalletTx, userId: string, amount: DemoAmount, idempotencyKey: string,
  type: "MATCH_WIN", matchId: string, description?: string,
) {
  requireKey(idempotencyKey);
  if (!matchId) throw new Error("MATCH_REQUIRED");
  await assertDemoMatch(tx, matchId);
  const value = positiveAmount(amount);
  const wallet = await lockDemoWalletRow(tx, userId);
  return creditWithDebtPriority(tx, wallet, value, idempotencyKey, type, matchId, description);
}

async function adjustDemoCreditsInTransaction(
  tx: DemoWalletTx, userId: string, signedAmount: DemoAmount, idempotencyKey: string, description: string,
) {
  requireKey(idempotencyKey);
  if (!description?.trim()) throw new Error("ADJUSTMENT_REASON_REQUIRED");
  const delta = decimal(signedAmount);
  if (delta.isZero()) throw new Error("INVALID_AMOUNT");
  const wallet = await lockDemoWalletRow(tx, userId);
  if (delta.gt(0)) return creditWithDebtPriority(tx, wallet, delta, idempotencyKey, "BALANCE_ADJUSTMENT", undefined, description);
  const existing = await existingForWallet(tx, idempotencyKey, {
    walletId: wallet.id, userId, type: "BALANCE_ADJUSTMENT", amount: delta,
  });
  if (existing) return { idempotent: true, transaction: existing, wallet };

  const after = wallet.balance.plus(delta).toDecimalPlaces(4);
  if (after.isNegative()) throw new Error("INSUFFICIENT_DEMO_BALANCE");
  const updatedWallet = await tx.demoWallet.update({ where: { id: wallet.id }, data: { balance: after } });
  const transaction = await appendWalletTransaction(tx, {
    wallet, balanceBefore: wallet.balance, balanceAfter: after, amount: delta,
    type: "BALANCE_ADJUSTMENT", idempotencyKey, description,
  });
  return { idempotent: false, transaction, wallet: updatedWallet };
}

async function lockDemoWalletHoldInTransaction(
  tx: DemoWalletTx, userId: string, matchId: string, amount: DemoAmount,
  debitIdempotencyKey: string, holdIdempotencyKey: string,
) {
  requireKey(holdIdempotencyKey);
  if (!matchId) throw new Error("MATCH_REQUIRED");
  await assertDemoMatch(tx, matchId);
  const value = positiveAmount(amount);
  const wallet = await lockDemoWalletRow(tx, userId);
  const hold = await tx.demoWalletHold.findUnique({ where: { idempotencyKey: holdIdempotencyKey } });
  const lockLedgerKey = `demo:hold-lock:${holdIdempotencyKey}`;
  if (hold) {
    if (hold.walletId !== wallet.id || hold.matchId !== matchId || !hold.amount.eq(value)) throw new Error("IDEMPOTENCY_CONFLICT");
    if (hold.status !== "ACTIVE") throw new Error("DEMO_HOLD_ALREADY_CLOSED");
    const priorLock = await existingForWallet(tx, lockLedgerKey, {
      walletId: wallet.id, userId, type: "MATCH_STAKE_LOCK", amount: new Prisma.Decimal(0), matchId,
    });
    if (!priorLock) throw new Error("DEMO_LEDGER_HOLD_INCONSISTENT");
    return { idempotent: true, transaction: priorLock, hold, wallet };
  }

  const existingMatchHold = await tx.demoWalletHold.findFirst({ where: { walletId: wallet.id, matchId } });
  if (existingMatchHold) throw new Error("DEMO_HOLD_ALREADY_EXISTS");
  const debit = await tx.demoTransaction.findUnique({ where: { idempotencyKey: debitIdempotencyKey } });
  if (!debit || debit.walletId !== wallet.id || debit.userId !== userId || debit.matchId !== matchId || debit.type !== "MATCH_STAKE" || !debit.amount.eq(value.negated())) {
    throw new Error("DEMO_STAKE_DEBIT_NOT_FOUND");
  }

  const after = wallet.lockedBalance.plus(value).toDecimalPlaces(4);
  const updatedWallet = await tx.demoWallet.update({ where: { id: wallet.id }, data: { lockedBalance: after } });
  const createdHold = await tx.demoWalletHold.create({
    data: { walletId: wallet.id, matchId, amount: value, status: "ACTIVE", idempotencyKey: holdIdempotencyKey },
  });
  const transaction = await appendWalletTransaction(tx, {
    wallet, balanceBefore: wallet.balance, balanceAfter: wallet.balance,
    amount: new Prisma.Decimal(0), type: "MATCH_STAKE_LOCK", idempotencyKey: lockLedgerKey,
    matchId, description: "DEMO match stake held",
  });
  return { idempotent: false, transaction, hold: createdHold, wallet: updatedWallet };
}

async function reserveDemoStakeInTransaction(
  tx: DemoWalletTx, userId: string, matchId: string, amount: DemoAmount,
  debitIdempotencyKey: string, holdIdempotencyKey: string,
) {
  const debit = await debitDemoCreditsInTransaction(tx, userId, amount, debitIdempotencyKey, matchId, "DEMO match stake");
  const hold = await lockDemoWalletHoldInTransaction(tx, userId, matchId, amount, debitIdempotencyKey, holdIdempotencyKey);
  return { idempotent: debit.idempotent && hold.idempotent, debit, hold };
}

async function closeDemoWalletHoldInTransaction(
  tx: DemoWalletTx, userId: string, matchId: string, amount: DemoAmount,
  idempotencyKey: string, finalStatus: "RELEASED" | "CONSUMED",
) {
  requireKey(idempotencyKey);
  if (!matchId) throw new Error("MATCH_REQUIRED");
  await assertDemoMatch(tx, matchId);
  const value = positiveAmount(amount);
  const wallet = await lockDemoWalletRow(tx, userId);
  const ledgerType = finalStatus === "RELEASED" ? "MATCH_REFUND" : "MATCH_STAKE_RELEASE";
  const ledgerAmount = finalStatus === "RELEASED" ? value : new Prisma.Decimal(0);
  const existing = await existingForWallet(tx, idempotencyKey, {
    walletId: wallet.id, userId, type: ledgerType, amount: ledgerAmount, matchId,
  });
  if (existing) return { idempotent: true, transaction: existing, wallet };

  const hold = await tx.demoWalletHold.findFirst({ where: { walletId: wallet.id, matchId } });
  if (!hold) throw new Error("DEMO_HOLD_NOT_FOUND");
  if (!hold.amount.eq(value)) throw new Error("DEMO_HOLD_AMOUNT_MISMATCH");
  if (hold.status !== "ACTIVE") throw new Error("DEMO_HOLD_ALREADY_CLOSED");
  if (wallet.lockedBalance.lt(value)) throw new Error("DEMO_LOCKED_BALANCE_INSUFFICIENT");

  const balanceAfter = finalStatus === "RELEASED" ? wallet.balance.plus(value).toDecimalPlaces(4) : wallet.balance;
  const lockedAfter = wallet.lockedBalance.minus(value).toDecimalPlaces(4);
  const updatedWallet = await tx.demoWallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter, lockedBalance: lockedAfter } });
  const closedAt = new Date();
  const claimed = await tx.demoWalletHold.updateMany({
    where: { id: hold.id, status: "ACTIVE", amount: value },
    data: { status: finalStatus, closedAt },
  });
  if (claimed.count !== 1) throw new Error("DEMO_HOLD_CONFLICT");
  const transaction = await appendWalletTransaction(tx, {
    wallet, balanceBefore: wallet.balance, balanceAfter, amount: ledgerAmount,
    type: ledgerType, idempotencyKey, matchId,
    description: finalStatus === "RELEASED" ? "DEMO match stake refunded" : "DEMO match stake consumed",
  });
  return { idempotent: false, transaction, wallet: updatedWallet, hold: { ...hold, status: finalStatus, closedAt } };
}

async function resolveDemoDisputeInTransaction(
  tx: DemoWalletTx,
  matchId: string,
  disputeId: string,
  decision: "DRAW" | "WINNER_PLAYER_ONE" | "WINNER_PLAYER_TWO" | "CANCELLED_REFUND",
  winnerId: string | null,
  stakeAmount: DemoAmount,
  feeAmount: DemoAmount,
) {
  requireKey(disputeId);
  await assertDemoMatch(tx, matchId);
  const stake = positiveAmount(stakeAmount);
  const fee = decimal(feeAmount);
  if (fee.isNegative()) throw new Error("INVALID_AMOUNT");
  const matches = await tx.$queryRaw<Array<{ playerOneId: string; playerTwoId: string | null }>>`
    SELECT "playerOneId", "playerTwoId" FROM "Match" WHERE "id" = ${matchId}::uuid FOR UPDATE
  `;
  const match = matches[0];
  if (!match?.playerOneId || !match.playerTwoId || match.playerOneId === match.playerTwoId) throw new Error("INVALID_MATCH_PLAYERS");
  const expectedWinnerId = decision === "WINNER_PLAYER_ONE" ? match.playerOneId
    : decision === "WINNER_PLAYER_TWO" ? match.playerTwoId : null;
  if (winnerId !== expectedWinnerId) throw new Error("DISPUTE_DECISION_MISMATCH");
  const userIds = [match.playerOneId, match.playerTwoId].sort();
  for (const userId of userIds) await ensureWallet(tx, userId);
  const walletRows = await tx.$queryRaw<DemoWalletRow[]>`
    SELECT "id", "userId", "balance", "lockedBalance", "debtBalance"
    FROM "DemoWallet" WHERE "userId" IN (${Prisma.join(userIds.map(id => Prisma.sql`${id}::uuid`))})
    ORDER BY "userId" ASC FOR UPDATE
  `;
  if (walletRows.length !== 2) throw new Error("DEMO_WALLET_NOT_FOUND");
  const wallets = new Map(walletRows.map(wallet => [wallet.userId, wallet]));
  const holds = await tx.demoWalletHold.findMany({ where: { walletId: { in: walletRows.map(wallet => wallet.id) }, matchId } });
  if (holds.length !== 2 || holds.some(hold => hold.status !== "CONSUMED" || !hold.amount.eq(stake))) {
    throw new Error("DEMO_SETTLEMENT_HOLD_INCONSISTENT");
  }

  const originalWins = await tx.demoTransaction.findMany({ where: { matchId, type: "MATCH_WIN" } });
  if (originalWins.length !== 1 || !originalWins[0].userId || !userIds.includes(originalWins[0].userId)) {
    throw new Error("DEMO_SETTLEMENT_NOT_FOUND");
  }
  const originalWin = originalWins[0];
  const originalWinnerId = originalWin.userId!;
  const winMetadata = originalWin.metadata && typeof originalWin.metadata === "object" && !Array.isArray(originalWin.metadata)
    ? originalWin.metadata as Record<string, unknown>
    : null;
  const originalGross = winMetadata?.grossAmount === undefined
    ? originalWin.amount
    : new Prisma.Decimal(String(winMetadata.grossAmount));
  const expectedPayout = Prisma.Decimal.max(new Prisma.Decimal(0), stake.mul(2).minus(fee)).toDecimalPlaces(4);
  if (!originalGross.eq(expectedPayout)) throw new Error("DEMO_SETTLEMENT_AMOUNT_INCONSISTENT");
  const originalFees = await tx.demoTransaction.findMany({ where: { matchId, type: "MATCH_FEE" } });
  if ((fee.gt(0) && (originalFees.length !== 1 || !originalFees[0].amount.eq(fee))) || (fee.isZero() && originalFees.length !== 0)) {
    throw new Error("DEMO_SETTLEMENT_FEE_INCONSISTENT");
  }

  if (winnerId !== originalWinnerId) {
    const originalWallet = wallets.get(originalWinnerId)!;
    const key = `demo:dispute:${disputeId}:reverse:${originalWinnerId}`;
    const priorDebit = await tx.demoTransaction.findUnique({ where: { idempotencyKey: key } });
    const priorDebt = await tx.demoTransaction.findUnique({ where: { idempotencyKey: `${key}:debt` } });
    if (priorDebit || priorDebt) throw new Error("DEMO_DISPUTE_ADJUSTMENT_PARTIAL");

    const debit = Prisma.Decimal.min(originalWallet.balance, originalGross).toDecimalPlaces(4);
    const debtCreated = originalGross.minus(debit).toDecimalPlaces(4);
    const balanceAfter = originalWallet.balance.minus(debit).toDecimalPlaces(4);
    const debtAfter = originalWallet.debtBalance.plus(debtCreated).toDecimalPlaces(4);
    const reversedWallet = await tx.demoWallet.update({ where: { id: originalWallet.id }, data: { balance: balanceAfter, debtBalance: debtAfter } });
    wallets.set(originalWinnerId, reversedWallet);
    if (debit.gt(0)) {
      await appendWalletTransaction(tx, {
        wallet: originalWallet, balanceBefore: originalWallet.balance, balanceAfter,
        amount: debit.negated(), type: "DISPUTE_ADJUSTMENT", idempotencyKey: key, matchId,
        description: "DEMO prior match payout reversed by dispute",
        metadata: { disputeId, decision, originalSettlementId: originalWin.id, grossReversed: originalGross.toFixed(4) },
      });
    }
    if (debtCreated.gt(0)) {
      await appendWalletTransaction(tx, {
        wallet: originalWallet, balanceBefore: balanceAfter, balanceAfter,
        amount: debtCreated, type: "DEBT_ADJUSTMENT", idempotencyKey: `${key}:debt`, matchId,
        description: "DEMO virtual debt created by disputed payout reversal",
        metadata: { disputeId, decision, originalSettlementId: originalWin.id, grossReversed: originalGross.toFixed(4) },
      });
    }
  }

  if (winnerId && winnerId !== originalWinnerId) {
    await creditWithDebtPriority(tx, wallets.get(winnerId)!, expectedPayout,
      `demo:dispute:${disputeId}:award:${winnerId}`, "MATCH_WIN", matchId, "DEMO dispute resolution payout");
  } else if (!winnerId) {
    for (const userId of userIds) {
      await creditWithDebtPriority(tx, wallets.get(userId)!, stake,
        `demo:dispute:${disputeId}:refund:${userId}`, "MATCH_REFUND", matchId, "DEMO dispute resolution refund");
    }
    if (fee.gt(0)) {
      const feeKey = `demo:dispute:${disputeId}:fee-reversal`;
      const existingFeeReversal = await tx.demoTransaction.findUnique({ where: { idempotencyKey: feeKey } });
      if (existingFeeReversal) {
        if (existingFeeReversal.type !== "MATCH_FEE_ADJUSTMENT" || existingFeeReversal.matchId !== matchId || !existingFeeReversal.amount.eq(fee.negated())) throw new Error("IDEMPOTENCY_CONFLICT");
      } else {
        await tx.demoTransaction.create({ data: {
          walletId: null, userId: null, matchId, type: "MATCH_FEE_ADJUSTMENT", amount: fee.negated(),
          balanceBefore: null, balanceAfter: null, idempotencyKey: feeKey,
          description: "DEMO match fee reversed by dispute refund",
          metadata: { disputeId, decision, originalFeeId: originalFees[0].id },
        } });
      }
    }
  }
  return { idempotent: false, originalWinnerId, winnerId, debtCreated: winnerId === originalWinnerId ? "0.0000" : undefined };
}

async function recordDemoMatchFeeInTransaction(tx: DemoWalletTx, matchId: string, amount: DemoAmount, idempotencyKey: string) {
  requireKey(idempotencyKey);
  if (!matchId) throw new Error("MATCH_REQUIRED");
  await assertDemoMatch(tx, matchId);
  const value = positiveAmount(amount);
  const existing = await tx.demoTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.type !== "MATCH_FEE" || existing.matchId !== matchId || !existing.amount.eq(value) || existing.walletId || existing.userId) {
      throw new Error("IDEMPOTENCY_CONFLICT");
    }
    return { idempotent: true, transaction: existing };
  }

  // PostgreSQL ON CONFLICT DO NOTHING avoids aborting this transaction when
  // another caller concurrently inserts the same unique idempotency key.
  // The schema has no other applicable unique key for MATCH_FEE rows.
  const inserted = await tx.demoTransaction.createMany({
    data: [{
      walletId: null, userId: null, matchId, type: "MATCH_FEE", amount: value,
      balanceBefore: null, balanceAfter: null, idempotencyKey, description: "DEMO match virtual commission",
    }],
    skipDuplicates: true,
  });
  const transaction = await tx.demoTransaction.findFirst({ where: { idempotencyKey } });
  if (!transaction) throw new Error("DEMO_FEE_WRITE_NOT_FOUND");
  if (transaction.type !== "MATCH_FEE" || transaction.matchId !== matchId || !transaction.amount.eq(value) || transaction.walletId || transaction.userId) {
    throw new Error("IDEMPOTENCY_CONFLICT");
  }
  return { idempotent: inserted.count === 0, transaction };
}

function createOperations(tx: DemoWalletTx, isActive: () => boolean): DemoWalletOperations {
  const assertActive = () => { if (!isActive()) throw new Error("DEMO_TRANSACTION_SCOPE_CLOSED"); };
  return {
    getOrCreateDemoWallet: async userId => { assertActive(); return getOrCreateDemoWalletInTransaction(tx, userId); },
    grantDemoStarterCredits: async userId => { assertActive(); return grantDemoStarterCreditsInTransaction(tx, userId); },
    creditDemoCredits: async (...args) => { assertActive(); return creditDemoCreditsInTransaction(tx, ...args); },
    adjustDemoCredits: async (...args) => { assertActive(); return adjustDemoCreditsInTransaction(tx, ...args); },
    reserveDemoStake: async (...args) => { assertActive(); return reserveDemoStakeInTransaction(tx, ...args); },
    closeDemoWalletHold: async (...args) => { assertActive(); return closeDemoWalletHoldInTransaction(tx, ...args); },
    recordDemoMatchFee: async (...args) => { assertActive(); return recordDemoMatchFeeInTransaction(tx, ...args); },
    resolveDemoDispute: async (...args) => { assertActive(); return resolveDemoDisputeInTransaction(tx, ...args); },
  };
}

/**
 * The sole composition boundary. It owns one real interactive Prisma
 * transaction and exposes its client alongside DEMO operations, so Match and
 * DEMO writes can commit/rollback together. Do not call standalone methods from
 * this callback; use context.demo. Wallets in a multi-user settlement must be
 * visited in ascending userId order to keep row-lock order consistent.
 */
export async function withDemoTransaction<T>(work: (context: DemoTransactionContext) => Promise<T>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
  if (transactionScope.getStore()) throw new Error("NESTED_DEMO_TRANSACTION_NOT_ALLOWED");
  return prisma.$transaction(async rawTx => {
    const scope = { token: Symbol("demo-transaction"), active: true };
    const tx = rawTx as DemoWalletTx;
    const context: DemoTransactionContext = {
      db: tx,
      demo: createOperations(tx, () => scope.active && transactionScope.getStore()?.token === scope.token),
    };
    try {
      return await transactionScope.run(scope, () => work(context));
    } finally {
      scope.active = false;
    }
  }, options);
}

async function standalone<T>(operation: (demo: DemoWalletOperations) => Promise<T>): Promise<T> {
  if (transactionScope.getStore()) throw new Error("NESTED_DEMO_TRANSACTION_NOT_ALLOWED");
  return withDemoTransaction(({ demo }) => operation(demo));
}

// Public standalone operations always own their transaction. For composition
// with Match writes, use withDemoTransaction and its callback-scoped facade.
export const getOrCreateDemoWallet = (userId: string) => standalone(demo => demo.getOrCreateDemoWallet(userId));
export const grantDemoStarterCredits = (userId: string) => standalone(demo => demo.grantDemoStarterCredits(userId));
export const creditDemoCredits = (...args: Parameters<DemoWalletOperations["creditDemoCredits"]>) => standalone(demo => demo.creditDemoCredits(...args));
export const adjustDemoCredits = (...args: Parameters<DemoWalletOperations["adjustDemoCredits"]>) => standalone(demo => demo.adjustDemoCredits(...args));
export const reserveDemoStake = (...args: Parameters<DemoWalletOperations["reserveDemoStake"]>) => standalone(demo => demo.reserveDemoStake(...args));
export const closeDemoWalletHold = (...args: Parameters<DemoWalletOperations["closeDemoWalletHold"]>) => standalone(demo => demo.closeDemoWalletHold(...args));
export const recordDemoMatchFee = (...args: Parameters<DemoWalletOperations["recordDemoMatchFee"]>) => standalone(demo => demo.recordDemoMatchFee(...args));
