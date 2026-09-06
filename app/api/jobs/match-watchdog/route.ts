import { NextResponse } from "next/server";
import { runMatchWatchdog } from "@/lib/match-lifecycle";
export async function POST(request: Request) {
  if (request.headers.get("x-duelplay-job-secret") !== process.env.DUELPLAY_JOB_SECRET) return NextResponse.json({error:"Unauthorized"},{status:401});
  try { return NextResponse.json({ok:true, ...(await runMatchWatchdog())}); }
  catch (e) { console.error(e); return NextResponse.json({error:"Watchdog failed"},{status:500}); }
}
