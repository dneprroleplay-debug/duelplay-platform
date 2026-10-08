import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasPermission, requireAdminAccess } from "@/lib/admin-rbac";

export async function GET() {
  try {
    const access = await requireAdminAccess();
    const p = access.permissions;
    const canUsers = hasPermission(p, "users.view");
    const canMatches = hasPermission(p, "matches.view");
    const canFinance = hasPermission(p, "finance.view") || hasPermission(p, "ledger.view");
    const canServers = hasPermission(p, "servers.view");
    const canSupport = hasPermission(p, "support.view");
    const canSecurity = hasPermission(p, "security.view") || hasPermission(p, "incidents.view");
    const canReports = hasPermission(p, "reports.view") || hasPermission(p, "analytics.view");
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [users, online, matches24h, liveMatches, servers, disputes, fraud, pendingWithdrawals, pendingDeposits, activeMatches] = await Promise.all([
      canUsers ? prisma.user.count({ where: { deletedAt: null } }) : Promise.resolve(null),
      prisma.userSession.count({ where: { isRevoked: false, expiresAt: { gt: now }, lastActiveAt: { gte: new Date(now.getTime() - 5 * 60 * 1000) } } }),
      canMatches || canReports ? prisma.match.count({ where: { createdAt: { gte: dayAgo } } }) : Promise.resolve(null),
      canMatches ? prisma.match.count({ where: { status: "LIVE" } }) : Promise.resolve(null),
      canServers ? prisma.gameServer.count({ where: { status: { in: ["BUSY", "STARTING"] } } }) : Promise.resolve(null),
      canSecurity ? prisma.dispute.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW", "AI_PROCESSED"] } } }) : Promise.resolve(null),
      canSecurity ? prisma.fraudCase.count({ where: { status: { notIn: ["CONFIRMED_BANNED", "FALSE_POSITIVE_CLEARED"] } } }) : Promise.resolve(null),
      canFinance ? prisma.withdrawal.count({ where: { status: { notIn: ["COMPLETED", "REJECTED", "FAILED"] } } }) : Promise.resolve(null),
      canFinance ? prisma.deposit.count({ where: { status: { notIn: ["COMPLETED", "FAILED", "EXPIRED"] } } }) : Promise.resolve(null),
      canMatches
        ? prisma.match.findMany({
            where: { status: { in: ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE"] } },
            orderBy: { createdAt: "desc" },
            take: 8,
            select: {
              id: true,
              status: true,
              mapName: true,
              betAmount: true,
              createdAt: true,
              playerOne: { select: { nickname: true } },
              playerTwo: { select: { nickname: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    return NextResponse.json(
      {
        serverTime: now.toISOString(),
        permissions: { users: canUsers, matches: canMatches, finance: canFinance, servers: canServers, support: canSupport, security: canSecurity, reports: canReports },
        counters: { users, online, matches24h, liveMatches, servers, openDisputes: disputes, openFraud: fraud, pendingWithdrawals, pendingDeposits },
        activeMatches,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора", errorCode: code }, { status: 401 });
    if (code === "ADMIN_MFA_SETUP_REQUIRED" || code === "ADMIN_MFA_REQUIRED") return NextResponse.json({ error: "Требуется подтверждение MFA администратора", errorCode: code }, { status: 403 });
    return NextResponse.json({ error: "Недостаточно прав", errorCode: code }, { status: 403 });
  }
}
