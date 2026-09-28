import { NextResponse } from "next/server";
import { getPlatformVersion } from "@/lib/platform-version";

export const dynamic = "force-dynamic";

export async function GET() {
  const version = await getPlatformVersion();

  return NextResponse.json(
    { version },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
