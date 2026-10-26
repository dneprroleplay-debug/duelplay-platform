import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isFreshServerManagerRequest } from "../../auth";
import { getDueCs2UpdateOccurrence } from "@/lib/cs2-update-schedule.mjs";
import { CS2_UPDATE_SCHEDULE_LOCK, readCs2UpdateSchedule } from "@/lib/cs2-update-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isFreshServerManagerRequest(request))) return NextResponse.json({ errorCode: "UNAUTHORIZED_OR_EXPIRED" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ errorCode: "INVALID_BODY" }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ errorCode: "INVALID_JSON" }, { status: 400 }); }

  const expectedRevision = Number(body.revision);
  const requestedDate = typeof body.localDate === "string" ? body.localDate : "";
  const requestedTime = typeof body.localTime === "string" ? body.localTime : "";
  if (!Number.isInteger(expectedRevision) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !/^\d{2}:\d{2}$/.test(requestedTime)) {
    return NextResponse.json({ errorCode: "INVALID_SCHEDULE_CLAIM" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CS2_UPDATE_SCHEDULE_LOCK}))`;
      const { schedule, configured, invalid } = await readCs2UpdateSchedule(tx);
      if (!schedule || !configured || invalid) throw new Error("SCHEDULE_INVALID");
      if (schedule.revision !== expectedRevision || schedule.localTime !== requestedTime) return { claimed: false, reason: "SCHEDULE_CHANGED" as const };
      const due = getDueCs2UpdateOccurrence(schedule, new Date());
      if (!due) return { claimed: false, reason: schedule.enabled ? "NOT_DUE" as const : "DISABLED" as const };
      if (due.localDate !== requestedDate || due.localTime !== requestedTime) return { claimed: false, reason: "SCHEDULE_CHANGED" as const };

      const existing = await tx.cs2UpdateRun.findUnique({ where: { localDate: due.localDate } });
      if (existing) return { claimed: false, reason: "ALREADY_CLAIMED_TODAY" as const, runId: existing.id, status: existing.status };

      const run = await tx.cs2UpdateRun.create({
        data: {
          localDate: due.localDate,
          scheduledAt: new Date(due.scheduledAt),
          scheduledLocalTime: due.localTime,
          timeZone: due.timeZone,
          scheduleRevision: schedule.revision,
          source: "SCHEDULED",
          status: "RUNNING",
          stage: "SCHEDULE_CLAIMED",
          checkedInstances: [] as Prisma.InputJsonArray,
          diagnostics: [] as Prisma.InputJsonArray,
        },
      });
      const legacyStatus = { status: "RUNNING", startedAt: run.startedAt.toISOString(), runId: run.id, localDate: due.localDate, scheduledLocalTime: due.localTime };
      await tx.siteSettings.upsert({
        where: { key: "CS2_UPDATE_STATUS" },
        update: { value: legacyStatus, updatedBy: null },
        create: { key: "CS2_UPDATE_STATUS", value: legacyStatus, description: "Latest automated CS2 update status", updatedBy: null },
      });
      return { claimed: true, runId: run.id, localDate: due.localDate, scheduledAt: due.scheduledAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ ok: true, ...result }, { status: result.claimed ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.cs2UpdateRun.findUnique({ where: { localDate: requestedDate }, select: { id: true, status: true } });
      return NextResponse.json({ ok: true, claimed: false, reason: "ALREADY_CLAIMED_TODAY", runId: existing?.id ?? null, status: existing?.status ?? null }, { headers: { "Cache-Control": "no-store" } });
    }
    const code = error instanceof Error ? error.message : "";
    if (code === "SCHEDULE_INVALID") return NextResponse.json({ errorCode: code }, { status: 503 });
    console.error("[CS2_UPDATE_CLAIM]", error);
    return NextResponse.json({ errorCode: "SCHEDULE_CLAIM_FAILED" }, { status: 500 });
  }
}
