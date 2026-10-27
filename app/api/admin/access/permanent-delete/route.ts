import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/admin-rbac";
import { getAuditContext } from "@/lib/request-meta";
import { withDemoTransaction } from "@/lib/demo-wallet";
import { secureWalletForAccountRecovery } from "@/lib/wallet";
import { recoveryHmac } from "@/lib/account-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_MATCH_STATUSES = ["CREATING", "WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE", "DISPUTED"] as const;
const ACTIVE_DISPUTE_STATUSES = ["OPEN", "UNDER_REVIEW", "AI_PROCESSED"] as const;
const PENDING_WITHDRAWAL_STATUSES = ["PENDING", "MANUAL_REVIEW", "PROCESSING"] as const;
const PENDING_DEPOSIT_STATUSES = ["PENDING", "PROCESSING"] as const;
const DELETE_ACTION = "USER_ACCOUNT_PERMANENTLY_DELETED";

function jsonError(error: string, status: number) { return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } }); }
function requireSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new Error("CSRF_ORIGIN_REJECTED");
}
async function requireFounder() {
  const access = await requireAdminAccess();
  // In this RBAC, FOUNDER is the only real level-999 identity. SUPERADMIN is a lower operational role.
  if (access.roleCode !== "FOUNDER" || access.level !== 999) throw new Error("FOUNDER_999_REQUIRED");
  return access;
}
function toAmount(value: Prisma.Decimal | null | undefined) { return value?.toFixed(4) ?? "0.0000"; }
async function getDeletionSnapshot(db: typeof prisma | Prisma.TransactionClient, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { wallet: { include: { holds: true } }, demoWallet: { include: { holds: true } }, adminRoleAssignment: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");
  const [activeMatches, activeDisputes, pendingTransactions, pendingDeposits, pendingWithdrawals, pendingCreatorPayouts, pendingMatchReservations] = await Promise.all([
    db.match.count({ where: { status: { in: [...ACTIVE_MATCH_STATUSES] }, OR: [{ playerOneId: userId }, { playerTwoId: userId }] } }),
    db.dispute.count({ where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] }, OR: [{ reporterId: userId }, { match: { is: { OR: [{ playerOneId: userId }, { playerTwoId: userId }] } } }] } }),
    user.wallet ? db.transaction.count({ where: { walletId: user.wallet.id, status: "PENDING" } }) : Promise.resolve(0),
    user.wallet ? db.deposit.count({ where: { walletId: user.wallet.id, status: { in: [...PENDING_DEPOSIT_STATUSES] } } }) : Promise.resolve(0),
    user.wallet ? db.withdrawal.count({ where: { walletId: user.wallet.id, status: { in: [...PENDING_WITHDRAWAL_STATUSES] } } }) : Promise.resolve(0),
    db.creatorPayout.count({ where: { userId, status: "PENDING" } }),
    db.demoMatchStartReservation.count({ where: { userId, status: "RESERVED" } }),
  ]);
  const realBalance = user.wallet?.balance ?? new Prisma.Decimal(0);
  const realLocked = user.wallet?.lockedBalance ?? new Prisma.Decimal(0);
  const realBonus = user.wallet?.bonusBalance ?? new Prisma.Decimal(0);
  const demoBalance = user.demoWallet?.balance ?? new Prisma.Decimal(0);
  const demoLocked = user.demoWallet?.lockedBalance ?? new Prisma.Decimal(0);
  const demoDebt = user.demoWallet?.debtBalance ?? new Prisma.Decimal(0);
  const realLastLedgerTransaction = user.wallet ? await db.transaction.findFirst({ where: { walletId: user.wallet.id, status: "COMPLETED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, balanceAfter: true, status: true } }) : null;
  const activeRealHoldRows = user.wallet?.holds.filter(h => h.status === "ACTIVE") ?? [];
  const activeDemoHoldRows = user.demoWallet?.holds.filter(h => h.status === "ACTIVE") ?? [];
  const activeRealHolds = activeRealHoldRows.length;
  const activeDemoHolds = activeDemoHoldRows.length;
  const activeRealHoldAmount = activeRealHoldRows.reduce((sum, hold) => sum.plus(hold.amount), new Prisma.Decimal(0));
  const activeDemoHoldAmount = activeDemoHoldRows.reduce((sum, hold) => sum.plus(hold.amount), new Prisma.Decimal(0));
  const pendingCount = pendingTransactions + pendingDeposits + pendingWithdrawals + pendingCreatorPayouts;
  const reasonCodes: string[] = [];
  if (user.deletedAt) reasonCodes.push("ALREADY_DELETED");
  if (user.role !== "USER" || user.adminRoleAssignment) reasonCodes.push("ADMIN_ACCOUNT_PROTECTED");
  if (activeMatches) reasonCodes.push("ACTIVE_MATCH");
  if (activeDisputes) reasonCodes.push("ACTIVE_DISPUTE");
  if (realLocked.gt(0) || demoLocked.gt(0) || activeRealHolds || activeDemoHolds) reasonCodes.push("LOCKED_FUNDS");
  if (pendingCount || pendingMatchReservations) reasonCodes.push("FINANCIAL_OPERATION_PENDING");
  if (!realBonus.eq(0)) reasonCodes.push("BONUS_BALANCE_UNRESOLVED");
  if (realBalance.gt(0)) {
    if (!user.email || !user.emailVerifiedAt || !user.steamId) reasonCodes.push("REAL_RECOVERY_IDENTITY_REQUIRED");
    try { if (user.email) recoveryHmac(user.email, "email"); if (user.steamId) recoveryHmac(user.steamId, "steam"); } catch { reasonCodes.push("ACCOUNT_RECOVERY_SECRET_REQUIRED"); }
    if (!realLastLedgerTransaction || !realLastLedgerTransaction.balanceAfter.eq(realBalance)) reasonCodes.push("REAL_LEDGER_UNVERIFIED");
  }
  if (demoBalance.lt(0) || demoDebt.gt(0)) reasonCodes.push("DEMO_BALANCE_UNRESOLVED");
  if (demoBalance.gt(0) && !user.isTestAccount) reasonCodes.push("DEMO_FUNDS_NOT_CONFIRMED_TEST_ACCOUNT");
  return {
    user,
    counts: { activeMatches, activeDisputes, pendingTransactions, pendingDeposits, pendingWithdrawals, pendingCreatorPayouts, pendingMatchReservations, activeRealHolds, activeDemoHolds },
    holdAmounts: { real: activeRealHoldAmount, demo: activeDemoHoldAmount },
    balances: { real: realBalance, realLocked: realLocked, realBonus: realBonus, demo: demoBalance, demoLocked: demoLocked, demoDebt: demoDebt },
    realLastLedgerTransaction,
    reasonCodes,
  };
}

function statusFor(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "ADMIN_LOGIN_REQUIRED") return [401, "Требуется вход администратора"] as const;
  if (code === "ADMIN_MFA_SETUP_REQUIRED" || code === "ADMIN_MFA_REQUIRED") return [403, "Требуется актуальное подтверждение MFA"] as const;
  if (code === "FOUNDER_999_REQUIRED") return [403, "Операция доступна только защищённому администратору уровня 999"] as const;
  if (code === "CSRF_ORIGIN_REJECTED") return [403, "Запрос отклонён проверкой same-origin"] as const;
  if (code === "USER_NOT_FOUND") return [404, "Пользователь не найден"] as const;
  if (code === "SELF_DELETE") return [403, "Нельзя удалить собственный аккаунт"] as const;
  if (code === "CONFIRM_NICKNAME_MISMATCH") return [400, "Введённый никнейм не совпадает"] as const;
  if (code === "REASON_REQUIRED") return [400, "Укажи причину удаления"] as const;
  if (code === "ALREADY_DELETED") return [409, "Аккаунт уже был удалён"] as const;
  if (["ADMIN_ACCOUNT_PROTECTED", "ACTIVE_MATCH", "ACTIVE_DISPUTE", "LOCKED_FUNDS", "FINANCIAL_OPERATION_PENDING", "BONUS_BALANCE_UNRESOLVED", "REAL_RECOVERY_IDENTITY_REQUIRED", "ACCOUNT_RECOVERY_SECRET_REQUIRED", "REAL_LEDGER_UNVERIFIED", "DEMO_BALANCE_UNRESOLVED", "DEMO_FUNDS_NOT_CONFIRMED_TEST_ACCOUNT", "FOUNDER_ACTOR_UNAVAILABLE"].includes(code)) {
    const messages: Record<string, string> = {
      ADMIN_ACCOUNT_PROTECTED: "Удаление аккаунтов с административной ролью запрещено.", BONUS_BALANCE_UNRESOLVED: "Бонусный баланс нельзя автоматически приравнивать к REAL или переносить; сначала обработайте его по правилам платформы.", REAL_RECOVERY_IDENTITY_REQUIRED: "Для безопасного сохранения REAL-баланса нужен подтверждённый email и привязанный Steam. Сначала завершите подтверждение личности.", ACCOUNT_RECOVERY_SECRET_REQUIRED: "Восстановление отключено: настройте постоянный DUELPLAY_ACCOUNT_RECOVERY_HMAC_SECRET (не менее 32 байт). Удаление отменено.", REAL_LEDGER_UNVERIFIED: "Текущий REAL-баланс не подтверждён последней записью ledger. Требуется финансовая сверка.", ACTIVE_MATCH: "Сначала завершите все активные матчи пользователя.", ACTIVE_DISPUTE: "Сначала закройте активный спор пользователя.", LOCKED_FUNDS: "Есть заблокированные средства или активные резервы. Удаление запрещено.", FINANCIAL_OPERATION_PENDING: "Есть незавершённые финансовые операции. Сначала разрешите их.", DEMO_BALANCE_UNRESOLVED: "DEMO-баланс имеет долг или некорректное значение; требуется финансовая сверка.", DEMO_FUNDS_NOT_CONFIRMED_TEST_ACCOUNT: "DEMO-баланс можно аннулировать только у подтверждённого тестового аккаунта.", FOUNDER_ACTOR_UNAVAILABLE: "Не удалось подтвердить действующую административную сессию.",
    };
    return [409, messages[code] || "Удаление не разрешено"] as const;
  }
  return [500, "Не удалось завершить удаление. Операция отменена без частичного результата."] as const;
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireFounder();
    const userId = new URL(request.url).searchParams.get("userId") || "";
    if (!userId) return jsonError("userId обязателен", 400);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return jsonError("Некорректный userId", 400);
    const snapshot = await getDeletionSnapshot(prisma, userId);
    return NextResponse.json({
      user: { id: snapshot.user.id, nickname: snapshot.user.nickname, email: snapshot.user.email, hasSteam: Boolean(snapshot.user.steamId), isTestAccount: snapshot.user.isTestAccount, role: snapshot.user.role, status: snapshot.user.status },
      balances: { real: toAmount(snapshot.balances.real), realLocked: toAmount(snapshot.balances.realLocked), realBonus: toAmount(snapshot.balances.realBonus), demo: toAmount(snapshot.balances.demo), demoLocked: toAmount(snapshot.balances.demoLocked), demoDebt: toAmount(snapshot.balances.demoDebt) },
      holdAmounts: { real: toAmount(snapshot.holdAmounts.real), demo: toAmount(snapshot.holdAmounts.demo) },
      operations: snapshot.counts,
      allowed: snapshot.reasonCodes.length === 0,
      blockedReasons: snapshot.reasonCodes,
      demoAnnulmentAmount: snapshot.balances.demo.gt(0) && snapshot.user.isTestAccount && snapshot.reasonCodes.length === 0 ? toAmount(snapshot.balances.demo) : "0.0000",
      realBalanceToSecure: snapshot.balances.real.gt(0) && snapshot.reasonCodes.length === 0 ? toAmount(snapshot.balances.real) : "0.0000",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { const [status, message] = statusFor(error); return jsonError(message, status); }
}

export async function POST(request: NextRequest) {
  let actorId = "";
  let targetId = "";
  let reason = "";
  try {
    const access = await requireFounder();
    actorId = access.user.id;
    const body = await request.json().catch(() => ({}));
    targetId = typeof body.userId === "string" ? body.userId : "";
    reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
    const confirmNickname = typeof body.confirmNickname === "string" ? body.confirmNickname.trim() : "";
    requireSameOrigin(request);
    if (!targetId) return jsonError("userId обязателен", 400);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) return jsonError("Некорректный userId", 400);
    if (!reason) throw new Error("REASON_REQUIRED");
    if (targetId === actorId) throw new Error("SELF_DELETE");

    const transferOperationId = randomUUID();
    const result = await withDemoTransaction(async ({ db: tx, demo }) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "userId" = ${targetId}::uuid FOR UPDATE`;
      const snapshot = await getDeletionSnapshot(tx, targetId);
      const target = snapshot.user;
      if (target.deletedAt) throw new Error("ALREADY_DELETED");
      if (target.nickname !== confirmNickname) throw new Error("CONFIRM_NICKNAME_MISMATCH");
      if (target.id === actorId) throw new Error("SELF_DELETE");
      if (target.role !== "USER" || target.adminRoleAssignment || target.nickname === "DuelPlayOwner" || Boolean(process.env.DUELPLAY_OWNER_STEAM_ID && target.steamId === process.env.DUELPLAY_OWNER_STEAM_ID.trim())) throw new Error("ADMIN_ACCOUNT_PROTECTED");
      if (snapshot.reasonCodes.length) throw new Error(snapshot.reasonCodes[0]);

      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, nickname: true, status: true } });
      if (!actor || actor.status !== "ACTIVE") throw new Error("FOUNDER_ACTOR_UNAVAILABLE");

      const beforeReal = snapshot.balances.real;
      const beforeDemo = snapshot.balances.demo;
      let demoAnnulment: { amount: string; sourceTransactionId: string | null } = { amount: "0.0000", sourceTransactionId: null };
      let recoveryRecordId: string | null = null;
      let recoveryHoldTransactionId: string | null = null;
      if (beforeDemo.gt(0)) {
        if (!target.isTestAccount) throw new Error("DEMO_FUNDS_NOT_CONFIRMED_TEST_ACCOUNT");
        await tx.$queryRaw`SELECT "id" FROM "DemoWallet" WHERE "userId" = ${targetId}::uuid FOR UPDATE`;
        const sourceWallet = await tx.demoWallet.findUnique({ where: { userId: targetId } });
        if (!sourceWallet || !sourceWallet.balance.eq(beforeDemo) || sourceWallet.lockedBalance.gt(0) || sourceWallet.debtBalance.gt(0)) throw new Error("DEMO_BALANCE_UNRESOLVED");
        const sourceKey = `account-delete:${transferOperationId}:demo-annul`;
        const sourceLedger = await demo.adjustDemoCredits(targetId, beforeDemo.negated(), sourceKey, `${reason} — account deletion DEMO balance annulled`);
        demoAnnulment = { amount: beforeDemo.toFixed(4), sourceTransactionId: sourceLedger.transaction.id };
      }

      // REAL is never moved to an administrator. Quarantine it in the existing wallet ledger,
      // and keep only HMAC identity indexes in AccountRecovery.
      if (beforeReal.gt(0)) {
        if (!target.email || !target.emailVerifiedAt || !target.steamId) throw new Error("REAL_RECOVERY_IDENTITY_REQUIRED");
        const emailHmac = recoveryHmac(target.email, "email");
        const steamHmac = recoveryHmac(target.steamId, "steam");
        const wallet = await tx.wallet.findUnique({ where: { userId: targetId } });
        if (!wallet || !snapshot.realLastLedgerTransaction || !snapshot.realLastLedgerTransaction.balanceAfter.eq(beforeReal)) throw new Error("REAL_LEDGER_UNVERIFIED");
        const holdKey = `account-recovery:${targetId}:hold`;
        const holdResult = await secureWalletForAccountRecovery(
          tx, targetId, beforeReal, holdKey, targetId,
          "REAL balance secured for one-time account recovery",
          { oldUserId: targetId, balance: beforeReal.toFixed(4), previousLedgerTransactionId: snapshot.realLastLedgerTransaction.id, reason } as Prisma.InputJsonValue,
        );
        if (holdResult.idempotent) throw new Error("ACCOUNT_RECOVERY_HOLD_ALREADY_EXISTS");
        const recoveryHold = holdResult.transaction;
        const recovery = await tx.accountRecovery.create({ data: {
          oldUserId: targetId, emailHmac, steamHmac, realBalance: beforeReal, currency: wallet.currency,
          status: "AVAILABLE", sourceLastTransactionId: snapshot.realLastLedgerTransaction.id,
          recoveryHoldTransactionId: recoveryHold.id,
        } });
        recoveryRecordId = recovery.id;
        recoveryHoldTransactionId = recoveryHold.id;
      }

      const now = new Date();
      await tx.userSession.deleteMany({ where: { userId: targetId } });
      await tx.passwordResetToken.deleteMany({ where: { userId: targetId } });
      await tx.emailVerificationCode.deleteMany({ where: { OR: [{ userId: targetId }, ...(target.email ? [{ email: target.email }] : [])] } });
      await tx.userDevice.deleteMany({ where: { userId: targetId } });
      await tx.kycVerification.deleteMany({ where: { userId: targetId } });
      await tx.notification.deleteMany({ where: { userId: targetId } });
      await tx.userMute.deleteMany({ where: { OR: [{ userId: targetId }, { mutedUserId: targetId }] } });
      await tx.socialMessage.deleteMany({ where: { OR: [{ senderId: targetId }, { receiverId: targetId }] } });
      await tx.friend.deleteMany({ where: { OR: [{ senderId: targetId }, { receiverId: targetId }] } });

      const tombstoneNickname = `Deleted-${targetId.replaceAll("-", "").slice(0, 20)}`;
      await tx.creatorProfile.updateMany({ where: { userId: targetId }, data: { displayName: tombstoneNickname, bio: null, referralCode: `deleted-${randomUUID()}`, campaigns: Prisma.DbNull } });
      await tx.user.update({ where: { id: targetId }, data: {
        email: null, emailVerifiedAt: null, passwordHash: null, steamId: null, avatarUrl: null, steamAvatarUrl: null,
        nickname: tombstoneNickname, nicknameNormalized: null, referralCode: `deleted-${randomUUID()}`,
        twoFactorEnabled: false, twoFactorSecret: null, lastLoginAt: null, lastLoginIp: null, country: null,
        profileVisibility: "PRIVATE", showStatsPublic: false, allowChallenges: false, allowMessages: false,
        status: "DEACTIVATED", deletedAt: now, isTestAccount: false,
      } });

      await tx.auditLog.create({ data: {
        userId: actorId, action: DELETE_ACTION, targetType: "USER", targetId, ipAddress: getAuditContext(request).ipAddress || "application",
        userAgent: getAuditContext(request).userAgent || "DuelPlay admin", requestId: getAuditContext(request).requestId || null,
        result: "SUCCESS", reason,
        payload: {
          deletedUserId: targetId, deletedNickname: target.nickname, adminId: actorId, adminNickname: actor.nickname,
          realBalanceBefore: beforeReal.toFixed(4), realBonusBalanceBefore: snapshot.balances.realBonus.toFixed(4), realLockedBalanceBefore: snapshot.balances.realLocked.toFixed(4), realCurrency: "REAL",
          demoBalanceBefore: beforeDemo.toFixed(4), demoLockedBalanceBefore: snapshot.balances.demoLocked.toFixed(4), demoDebtBalanceBefore: snapshot.balances.demoDebt.toFixed(4), demoCurrency: "DEMO",
          demoAnnulled: beforeDemo.gt(0), demoAnnulmentAmount: demoAnnulment.amount, demoLedgerTransactionId: demoAnnulment.sourceTransactionId,
          realBalanceSecured: beforeReal.toFixed(4), recoveryRecordId, recoveryHoldTransactionId, sourceLastTransactionId: snapshot.realLastLedgerTransaction?.id ?? null,
          result: "SUCCESS", deletedAt: now.toISOString(), reason,
        } as Prisma.InputJsonValue,
      } });
      return { ok: true, deletedUserId: targetId, demoAnnulled: beforeDemo.gt(0), demoAnnulmentAmount: demoAnnulment.amount, recoveryCreated: Boolean(recoveryRecordId) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const [status, message] = statusFor(error);
    if (actorId && targetId) {
      try {
        const ctx = getAuditContext(request);
        const adminSnapshot = await prisma.user.findUnique({ where: { id: actorId }, select: { nickname: true } });
        let failedSnapshot: Record<string, unknown> | null = null;
        try {
          const snapshot = await getDeletionSnapshot(prisma, targetId);
          failedSnapshot = {
            deletedUserId: targetId, deletedNickname: snapshot.user.nickname,
            realBalanceBefore: snapshot.balances.real.toFixed(4), realBalanceSecured: "not_committed", realBonusBalanceBefore: snapshot.balances.realBonus.toFixed(4),
            realLockedBalanceBefore: snapshot.balances.realLocked.toFixed(4), realCurrency: "REAL",
            demoBalanceBefore: snapshot.balances.demo.toFixed(4), demoLockedBalanceBefore: snapshot.balances.demoLocked.toFixed(4),
            demoDebtBalanceBefore: snapshot.balances.demoDebt.toFixed(4), demoCurrency: "DEMO",
            snapshotAt: new Date().toISOString(),
          };
        } catch { /* Keep failure audit even when a snapshot cannot be read. */ }
        await prisma.auditLog.create({ data: {
          userId: actorId, action: DELETE_ACTION, targetType: "USER", targetId, ipAddress: ctx.ipAddress || "application", userAgent: ctx.userAgent || "DuelPlay admin", requestId: ctx.requestId || null,
          result: "FAILURE", reason: `${reason || "Причина не указана"} | ${code}`.slice(0, 1000),
          payload: { operation: DELETE_ACTION, result: "FAILURE", errorCode: code, reason, adminId: actorId, adminNickname: adminSnapshot?.nickname ?? null, attemptedAt: new Date().toISOString(), ...(failedSnapshot || {}) } as Prisma.InputJsonValue,
        } });
      } catch { /* The operation must still return the original failure; never report a successful deletion. */ }
    }
    return jsonError(message, status);
  }
}
