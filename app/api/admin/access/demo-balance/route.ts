import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/admin-rbac";
import { withDemoTransaction } from "@/lib/demo-wallet";
import { isAllowedPublicOrigin } from "@/lib/security/public-origin.mjs";
import { getAuditContext } from "@/lib/request-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, [number, string]> = {
    ADMIN_LOGIN_REQUIRED: [401, "Требуется вход администратора"],
    ADMIN_MFA_SETUP_REQUIRED: [403, "Требуется настроить MFA администратора"],
    ADMIN_MFA_REQUIRED: [403, "Требуется подтверждение MFA администратора"],
    FORBIDDEN: [403, "Недостаточно прав"],
    CSRF_ORIGIN_REJECTED: [403, "Запрос отклонён проверкой same-origin"],
    INVALID_AMOUNT: [400, "Сумма должна быть положительным числом максимум с 4 знаками после запятой"],
    INVALID_REASON: [400, "Укажи причину операции (от 3 до 1000 символов)"],
    INVALID_OPERATION: [400, "Некорректный тип операции"],
    IDEMPOTENCY_CONFLICT: [409, "Ключ операции уже использован с другими параметрами"],
    INSUFFICIENT_DEMO_BALANCE: [409, "Недостаточно доступного DEMO-баланса"],
    USER_NOT_FOUND: [404, "Пользователь не найден"],
  };
  const [status, message] = messages[code] || [500, "Не удалось выполнить DEMO-корректировку"];
  return NextResponse.json({ ok: false, error: message, errorCode: code || "DEMO_ADJUSTMENT_FAILED" }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    if (!isAllowedPublicOrigin(request.headers.get("origin"), process.env, request.url)) throw new Error("CSRF_ORIGIN_REJECTED");
    const actor = await requirePermission("finance.wallet.adjust");
    const body = await request.json().catch(() => ({}));
    const userId = typeof body.userId === "string" ? body.userId : "";
    const operation = body.operation;
    const amountText = typeof body.amount === "string" ? body.amount.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const operationId = typeof body.operationId === "string" ? body.operationId : "";
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return NextResponse.json({ ok: false, error: "Некорректный пользователь" }, { status: 400 });
    if (operation !== "CREDIT" && operation !== "DEBIT") throw new Error("INVALID_OPERATION");
    if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(amountText)) throw new Error("INVALID_AMOUNT");
    const amount = new Prisma.Decimal(amountText);
    if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 4) throw new Error("INVALID_AMOUNT");
    if (reason.length < 3 || reason.length > 1000) throw new Error("INVALID_REASON");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) return NextResponse.json({ ok: false, error: "Некорректный идентификатор операции" }, { status: 400 });

    const idempotencyKey = `admin-demo-adjust:${actor.user.id}:${operationId}`;
    const auditContext = getAuditContext(request);
    const result = await withDemoTransaction(async ({ db, demo }) => {
      const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, deletedAt: true } });
      if (!target || target.deletedAt) throw new Error("USER_NOT_FOUND");
      const signedAmount = operation === "CREDIT" ? amount : amount.negated();
      const adjusted = await demo.adjustDemoCredits(
        userId,
        signedAmount,
        idempotencyKey,
        `ADMIN DEMO ADJUSTMENT · ${operation} · ${reason}`,
        {
          label: "ADMIN DEMO ADJUSTMENT",
          administratorId: actor.user.id,
          targetUserId: userId,
          operation,
          amount: amount.toFixed(4),
          reason,
        } as Prisma.InputJsonValue,
      );
      if (!adjusted.idempotent) {
        await db.auditLog.create({ data: {
          userId: actor.user.id,
          action: "ADMIN_DEMO_BALANCE_ADJUSTMENT",
          targetType: "USER",
          targetId: userId,
          ipAddress: auditContext.ipAddress || "application",
          userAgent: auditContext.userAgent || "DuelPlay admin",
          requestId: auditContext.requestId || null,
          result: "SUCCESS",
          reason,
          payload: {
            label: "ADMIN DEMO ADJUSTMENT",
            operation,
            administratorId: actor.user.id,
            targetUserId: userId,
            targetNickname: target.nickname,
            amount: amount.toFixed(4),
            signedAmount: signedAmount.toFixed(4),
            balanceBefore: adjusted.transaction.balanceBefore?.toFixed(4) ?? null,
            balanceAfter: adjusted.transaction.balanceAfter?.toFixed(4) ?? adjusted.wallet.balance.toFixed(4),
            demoTransactionId: adjusted.transaction.id,
            idempotencyKey,
          } as Prisma.InputJsonValue,
        } });
      }
      return {
        balance: adjusted.wallet.balance.toFixed(4),
        balanceBefore: adjusted.transaction.balanceBefore?.toFixed(4) ?? null,
        balanceAfter: adjusted.transaction.balanceAfter?.toFixed(4) ?? adjusted.wallet.balance.toFixed(4),
        transactionId: adjusted.transaction.id,
        idempotent: adjusted.idempotent,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
