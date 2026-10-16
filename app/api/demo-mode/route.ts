import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Public, read-only view of the global DEMO kill switch. Consumers only need a
 * boolean, so this exposes nothing beyond whether DEMO activity is allowed.
 * Fail-closed: a missing settings row (or a read error) reports `enabled:false`
 * so the UI never offers DEMO actions the server would reject.
 */
export async function GET() {
  try {
    const settings = await prisma.demoModeSettings.findUnique({
      where: { id: "global" },
      select: { enabled: true },
    });
    return NextResponse.json(
      { enabled: Boolean(settings?.enabled) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("demo-mode status failed", error);
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
}

export const dynamic = "force-dynamic";
