import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { secureSecretEqual } from "@/lib/secure-secret";
import { runMatchWatchdog } from "@/lib/match-lifecycle";
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "JOB_WATCHDOG", 30, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    throw error;
  }

  if (!secureSecretEqual(request.headers.get("x-duelplay-job-secret"), process.env.DUELPLAY_JOB_SECRET)) return NextResponse.json({error:"Unauthorized"},{status:401});
  try { return NextResponse.json({ok:true, ...(await runMatchWatchdog())}); }
  catch (e) { console.error(e); return NextResponse.json({error:"Watchdog failed"},{status:500}); }
}
