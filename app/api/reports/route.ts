import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertAbuseGuard } from "@/lib/anti-fraud";
import { audit } from "@/lib/admin";
import { hasPermission, requirePermission, resolveAdminAccess } from "@/lib/admin-rbac";

const TYPES = ["CHEATING", "ABUSE", "EXPLOITING", "HARASSMENT", "SUSPICIOUS_BEHAVIOUR"] as const;
const STATUSES = ["OPEN", "REVIEWED", "RESOLVED", "DISMISSED"] as const;
const MAX_REASON = 2000;
const MAX_EVIDENCE_BYTES = 20_000;

function jsonSize(value: unknown) {
  try { return Buffer.byteLength(JSON.stringify(value ?? null), "utf8"); } catch { return Infinity; }
}

export async function POST(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await r.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const type = String((body as Record<string, unknown>).type || "");
  const reason = String((body as Record<string, unknown>).reason || "").trim();
  const targetId = (body as Record<string, unknown>).targetId ? String((body as Record<string, unknown>).targetId) : null;
  const matchId = (body as Record<string, unknown>).matchId ? String((body as Record<string, unknown>).matchId) : null;
  const evidence = ((body as Record<string, unknown>).evidence ?? null) as Prisma.InputJsonValue;

  if (!TYPES.includes(type as (typeof TYPES)[number]) || !reason || reason.length > MAX_REASON) {
    return NextResponse.json({ error: "Invalid report type or reason" }, { status: 400 });
  }
  if (jsonSize(evidence) > MAX_EVIDENCE_BYTES) {
    return NextResponse.json({ error: "Evidence is too large" }, { status: 400 });
  }
  if (targetId === me.id) return NextResponse.json({ error: "Cannot report yourself" }, { status: 400 });

  try {
    const row = await prisma.$transaction(async tx => {
      await assertAbuseGuard(tx, me.id, "REPORT_CREATE");
      await enforceRateLimit(tx, me.id, "REPORT_CREATE", 5, 60 * 60 * 1000);

      if (targetId) {
        const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, deletedAt: true } });
        if (!target || target.deletedAt) throw new Error("TARGET_NOT_FOUND");
      }

      let match: { id: string; playerOneId: string | null; playerTwoId: string | null } | null = null;
      if (matchId) {
        match = await tx.match.findUnique({
          where: { id: matchId },
          select: { id: true, playerOneId: true, playerTwoId: true },
        });
        if (!match) throw new Error("MATCH_NOT_FOUND");
        if (![match.playerOneId, match.playerTwoId].includes(me.id)) throw new Error("NOT_MATCH_PARTICIPANT");
        if (targetId && ![match.playerOneId, match.playerTwoId].includes(targetId)) throw new Error("TARGET_NOT_IN_MATCH");
      }

      const duplicate = await tx.report.findFirst({
        where: {
          reporterId: me.id,
          targetId,
          matchId,
          type: type as never,
          status: { in: ["OPEN", "REVIEWED"] as never },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (duplicate) throw new Error("DUPLICATE_REPORT");

      const created = await tx.report.create({
        data: {
          reporterId: me.id,
          targetId,
          matchId,
          type: type as never,
          reason,
          evidence,
        },
      });
      return created;
    });

    await audit(me.id, "CREATE_REPORT", "REPORT", row.id, { type, targetId, matchId });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "RATE_LIMITED") return NextResponse.json({ error: "Too many reports. Please try later." }, { status: 429 });
      if (e.message === "TARGET_NOT_FOUND") return NextResponse.json({ error: "Target not found" }, { status: 404 });
      if (e.message === "MATCH_NOT_FOUND") return NextResponse.json({ error: "Match not found" }, { status: 404 });
      if (e.message === "NOT_MATCH_PARTICIPANT") return NextResponse.json({ error: "You are not a participant in this match" }, { status: 403 });
      if (e.message === "TARGET_NOT_IN_MATCH") return NextResponse.json({ error: "Target is not a participant in this match" }, { status: 400 });
      if (e.message === "DUPLICATE_REPORT") return NextResponse.json({ error: "You already have an open report of this type for this target" }, { status: 409 });
    }
    throw e;
  }
}

export async function GET(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(r.url);
  const requestedStatus = searchParams.get("status");
  const status = requestedStatus && STATUSES.includes(requestedStatus as (typeof STATUSES)[number]) ? requestedStatus : undefined;

  const access = await resolveAdminAccess(me.id);
  const canReview = Boolean(access && access.level > 0 && (hasPermission(access.permissions, "risk.cases.review") || hasPermission(access.permissions, "reports.view")));
  const where = {
    ...(canReview ? {} : { reporterId: me.id }),
    ...(status ? { status: status as never } : {}),
  };
  const rows = await prisma.report.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      reporter: { select: { id: true, nickname: true } },
      target: { select: { id: true, nickname: true } },
      match: { select: { id: true, status: true, mapName: true } },
    },
  });
  return NextResponse.json(rows);
}

export async function PATCH(r: NextRequest) {
  let access: Awaited<ReturnType<typeof requirePermission>>;
  try {
    access = await requirePermission("risk.cases.review");
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Unauthorized", errorCode: code }, { status: 401 });
    if (code === "FORBIDDEN" || code.startsWith("ADMIN_MFA_")) return NextResponse.json({ error: "Forbidden", errorCode: code }, { status: 403 });
    throw error;
  }
  const body = await r.json().catch(() => null);
  const id = String(body?.id || "");
  const status = String(body?.status || "");
  const notes = String(body?.notes || "").trim().slice(0, 2000);
  if (!id || !STATUSES.includes(status as (typeof STATUSES)[number])) return NextResponse.json({ error: "Invalid report update" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async tx => {
      const old = await tx.report.findUnique({ where: { id } });
      if (!old) throw new Error("REPORT_NOT_FOUND");
      if (old.status === status) return { row: old, previous: old.status };
      const valid =
        (old.status === "OPEN" && ["REVIEWED", "RESOLVED", "DISMISSED"].includes(status)) ||
        (old.status === "REVIEWED" && ["RESOLVED", "DISMISSED"].includes(status));
      if (!valid) throw new Error("INVALID_TRANSITION");
      const row = await tx.report.update({ where: { id }, data: { status: status as never, reviewedBy: access.user.id } });
      return { row, previous: old.status };
    });

    await audit(access.user.id, "UPDATE_REPORT", "REPORT", id, { oldStatus: result.previous, newStatus: status, notes });
    return NextResponse.json(result.row);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "REPORT_NOT_FOUND") return NextResponse.json({ error: "Report not found" }, { status: 404 });
    if (code === "INVALID_TRANSITION") return NextResponse.json({ error: "Invalid report status transition" }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Failed to update report" }, { status: 500 });
  }
}
