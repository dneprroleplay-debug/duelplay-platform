import { NextResponse } from "next/server";
import { isFreshServerManagerRequest } from "../auth";
import { CS2_UPDATE_TIME_ZONE, getDueCs2UpdateOccurrence, getNextCs2UpdateAt } from "@/lib/cs2-update-schedule.mjs";
import { readCs2UpdateSchedule } from "@/lib/cs2-update-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isFreshServerManagerRequest(request))) return NextResponse.json({ errorCode: "UNAUTHORIZED_OR_EXPIRED" }, { status: 401 });
  const result = await readCs2UpdateSchedule();
  if (!result.schedule || result.invalid) return NextResponse.json({ errorCode: "SCHEDULE_INVALID" }, { status: 503 });
  const now = new Date();
  return NextResponse.json({
    schedule: {
      enabled: result.schedule.enabled,
      localTime: result.schedule.localTime,
      timeZone: CS2_UPDATE_TIME_ZONE,
      revision: result.schedule.revision,
      scheduleChangedAt: result.schedule.scheduleChangedAt,
    },
    due: getDueCs2UpdateOccurrence(result.schedule, now),
    nextRunAt: getNextCs2UpdateAt(result.schedule, now),
    serverNow: now.toISOString(),
  }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
