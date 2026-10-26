import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isFreshServerManagerRequest } from "../../auth";
import { readCs2UpdateSchedule } from "@/lib/cs2-update-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isFreshServerManagerRequest(request))) return NextResponse.json({ errorCode: "UNAUTHORIZED_OR_EXPIRED" }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("runId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return NextResponse.json({ errorCode: "INVALID_RUN_ID" }, { status: 400 });
  const [run, scheduleRead] = await Promise.all([
    prisma.cs2UpdateRun.findUnique({ where: { id: runId }, select: { id: true, status: true, localDate: true, scheduleRevision: true, startedAt: true } }),
    readCs2UpdateSchedule(),
  ]);
  if (!run) return NextResponse.json({ errorCode: "UPDATE_RUN_NOT_FOUND" }, { status: 404 });
  if (run.status !== "RUNNING") return NextResponse.json({ errorCode: "UPDATE_RUN_NOT_ACTIVE", status: run.status }, { status: 409 });
  if (!scheduleRead.schedule || scheduleRead.invalid || !scheduleRead.configured || !scheduleRead.schedule.enabled || scheduleRead.schedule.revision !== run.scheduleRevision) {
    return NextResponse.json({ errorCode: "SCHEDULE_CHANGED_BEFORE_UPDATE" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, run }, { headers: { "Cache-Control": "no-store" } });
}
