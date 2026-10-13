import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { grantDemoStarterCredits } from "@/lib/demo-wallet";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized", errorCode: "AUTH_REQUIRED" }, { status: 401 });
  await prisma.$transaction(tx => enforceRateLimit(tx, user.id, "DEMO_WALLET_VIEW", 60, 60_000));
  const wallet = await prisma.demoWallet.findUnique({ where: { userId: user.id } });
  const transactions = wallet ? await prisma.demoTransaction.findMany({
    where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, take: 50,
    select: { id: true, type: true, amount: true, balanceBefore: true, balanceAfter: true, description: true, createdAt: true, matchId: true },
  }) : [];
  return NextResponse.json({
    economyMode: "DEMO",
    currency: "DC",
    balance: wallet?.balance.toString() ?? "0.0000",
    lockedBalance: wallet?.lockedBalance.toString() ?? "0.0000",
    debtBalance: wallet?.debtBalance.toString() ?? "0.0000",
    transactions,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized", errorCode: "AUTH_REQUIRED" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (body.action !== "claim-starter") return NextResponse.json({ error: "Unsupported DEMO wallet action" }, { status: 400 });
  try {
    await prisma.$transaction(tx => enforceRateLimit(tx, user.id, "DEMO_WALLET_GRANT", 10, 60_000));
    const grant = await grantDemoStarterCredits(user.id);
    const wallet = await prisma.demoWallet.findUniqueOrThrow({ where: { userId: user.id } });
    return NextResponse.json({ economyMode: "DEMO", currency: "DC", idempotent: grant.idempotent, balance: wallet.balance.toString(), lockedBalance: wallet.lockedBalance.toString(), debtBalance: wallet.debtBalance.toString() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "RATE_LIMITED") return NextResponse.json({ error: "Too many DEMO wallet requests", errorCode: code }, { status: 429 });
    console.error(error);
    return NextResponse.json({ error: "Could not load DEMO wallet", errorCode: code || "DEMO_WALLET_ERROR" }, { status: 500 });
  }
}
