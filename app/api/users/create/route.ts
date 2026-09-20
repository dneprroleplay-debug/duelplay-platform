import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    error: "Legacy endpoint disabled. Use the authenticated /api/matches flow.",
    errorCode: "LEGACY_ENDPOINT_DISABLED",
  }, { status: 410 });
}
