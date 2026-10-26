import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isFreshServerManagerRequest } from "../../auth";
import { normalizeCs2UpdateSchedule } from "@/lib/cs2-update-schedule.mjs";
import { CS2_UPDATE_SCHEDULE_KEY, CS2_UPDATE_SCHEDULE_LOCK, readCs2UpdateSchedule, sanitizeUpdateDiagnostic } from "@/lib/cs2-update-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isFreshServerManagerRequest(request))) return NextResponse.json({ errorCode: "UNAUTHORIZED_OR_EXPIRED" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ errorCode: "INVALID_BODY" }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ errorCode: "INVALID_JSON" }, { status: 400 }); }

  const agentStatus = String(body.agentStatus ?? "");
  const allowedStatuses = ["ONLINE", "DISABLED", "UPDATE_DUE", "UPDATE_RUNNING", "ERROR"];
  if (!allowedStatuses.includes(agentStatus)) return NextResponse.json({ errorCode: "INVALID_AGENT_STATUS" }, { status: 400 });
  const agentError = sanitizeUpdateDiagnostic(body.agentError, 1000);
  const now = new Date().toISOString();

  try {
    const schedule = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CS2_UPDATE_SCHEDULE_LOCK}))`;
      const current = await readCs2UpdateSchedule(tx);
      if (!current.schedule || current.invalid || !current.configured) throw new Error("SCHEDULE_INVALID");
      const next = normalizeCs2UpdateSchedule({ ...current.schedule, lastCheckedAt: now, agentStatus, agentError });
      if (!next) throw new Error("SCHEDULE_INVALID");
      await tx.siteSettings.update({ where: { key: CS2_UPDATE_SCHEDULE_KEY }, data: { value: next as Prisma.InputJsonValue } });
      return next;
    });
    return NextResponse.json({ ok: true, lastCheckedAt: schedule.lastCheckedAt, agentStatus: schedule.agentStatus }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SCHEDULE_INVALID") return NextResponse.json({ errorCode: code }, { status: 503 });
    console.error("[CS2_UPDATE_SCHEDULER_HEARTBEAT]", error);
    return NextResponse.json({ errorCode: "HEARTBEAT_FAILED" }, { status: 500 });
  }
}
