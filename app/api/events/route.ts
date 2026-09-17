import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, audit } from "@/lib/admin";
import { effectiveEventStatus, validateEventPayload, validateEventWindow, validateEventConfig, safeJson } from "@/lib/events";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const map: Record<string, string> = {
    INVALID_NAME: "Event name is required and must be 120 characters or less",
    INVALID_DATES: "Invalid event dates",
    INVALID_PREMIUM_PRICE: "Invalid premium price",
    INVALID_MULTIPLIER: "Invalid promo multiplier",
    PREMIUM_REQUIRES_PASS: "Premium pass requires event pass",
    CASE_NOT_FOUND: "Event case not found",
    JSON_TOO_LARGE: "Event configuration is too large",
    INVALID_JSON: "Invalid event configuration",
    INVALID_CONFIG: "Invalid event configuration",
    INVALID_MISSIONS: "Missions must be an array",
    INVALID_REWARDS: "Rewards must be an array",
    FORBIDDEN: "Forbidden",
  };
  return NextResponse.json({ error: map[code] || "Event operation failed" }, { status: code === "FORBIDDEN" ? 403 : 400 });
}

function present(row: any, now = new Date()) {
  return { ...row, status: effectiveEventStatus(row.status, new Date(row.startsAt), new Date(row.endsAt), now) };
}

export async function GET(r: NextRequest) {
  const adminView = new URL(r.url).searchParams.get("admin") === "1";
  try {
    if (adminView) await requireAdmin(5);
    const now = new Date();
    const rows = await prisma.event.findMany({
      where: adminView ? {} : { status: { in: ["SCHEDULED", "ACTIVE"] }, startsAt: { lte: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365) }, endsAt: { gte: now } },
      orderBy: { startsAt: "asc" }, take: 100,
    });
    return NextResponse.json(rows.map(x => present(x, now)));
  } catch (e) { return errorResponse(e); }
}

export async function POST(r: NextRequest) {
  try {
    const me = await requireAdmin(5);
    const b = await r.json().catch(() => ({}));
    const v = validateEventPayload(b);
    validateEventConfig(b);
    const now = new Date();
    const row = await prisma.$transaction(async tx => {
      const caseId = b.caseId ? String(b.caseId) : null;
      if (caseId) {
        const exists = await tx.duelCase.findUnique({ where: { id: caseId }, select: { id: true } });
        if (!exists) throw new Error("CASE_NOT_FOUND");
      }
      return tx.event.create({ data: {
      name: v.name, icon: b.icon ? String(b.icon).slice(0, 16) : null, startsAt: v.startsAt, endsAt: v.endsAt,
      theme: b.theme ? String(b.theme).slice(0, 80) : null, effects: safeJson(b.effects), missions: safeJson(b.missions), rewards: safeJson(b.rewards),
      caseId, leaderboard: safeJson(b.leaderboard), eventPass: b.eventPass === true,
      premiumPass: b.premiumPass === true, premiumPrice: v.premiumPrice, promoMultiplier: v.promoMultiplier,
      status: v.startsAt <= now && v.endsAt > now ? "ACTIVE" : "SCHEDULED",
      }});
    });
    await audit(me.id, "CREATE_EVENT", "EVENT", row.id, { name: row.name });
    return NextResponse.json(present(row), { status: 201 });
  } catch (e) { return errorResponse(e); }
}

export async function PATCH(r: NextRequest) {
  try {
    const me = await requireAdmin(5);
    const b = await r.json().catch(() => ({}));
    const id = String(b.id || "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const row = await prisma.$transaction(async tx => {
      const old = await tx.event.findUnique({ where: { id } });
      if (!old) throw new Error("NOT_FOUND");
      const startsAt = b.startsAt !== undefined ? new Date(String(b.startsAt)) : old.startsAt;
      const endsAt = b.endsAt !== undefined ? new Date(String(b.endsAt)) : old.endsAt;
      if (!validateEventWindow(startsAt, endsAt)) throw new Error("INVALID_DATES");
      const data: any = { startsAt, endsAt };
      validateEventConfig(b);
      if (b.name !== undefined) { const name = String(b.name).trim(); if (!name || name.length > 120) throw new Error("INVALID_NAME"); data.name = name; }
      for (const k of ["icon", "theme", "caseId"]) if (b[k] !== undefined) data[k] = b[k] === null ? null : String(b[k]);
      if (data.caseId) {
        const exists = await tx.duelCase.findUnique({ where: { id: data.caseId }, select: { id: true } });
        if (!exists) throw new Error("CASE_NOT_FOUND");
      }
      for (const k of ["effects", "missions", "rewards", "leaderboard"]) if (b[k] !== undefined) data[k] = safeJson(b[k]);
      if (b.eventPass !== undefined) data.eventPass = b.eventPass === true;
      if (b.premiumPass !== undefined) data.premiumPass = b.premiumPass === true;
      if (b.premiumPrice !== undefined) { const n = Number(b.premiumPrice); if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_PREMIUM_PRICE"); data.premiumPrice = n; }
      if (b.promoMultiplier !== undefined) { const n = Number(b.promoMultiplier); if (!Number.isFinite(n) || n < 1 || n > 100) throw new Error("INVALID_MULTIPLIER"); data.promoMultiplier = n; }
      if (b.status !== undefined) { const s = String(b.status); if (!["DRAFT","SCHEDULED","ACTIVE","ENDED","CANCELLED"].includes(s)) throw new Error("INVALID_STATUS"); if (s === "ACTIVE" && !(startsAt <= new Date() && endsAt > new Date())) throw new Error("ACTIVE_WINDOW"); data.status = s; }
      const finalEventPass = data.eventPass !== undefined ? data.eventPass : old.eventPass;
      const finalPremiumPass = data.premiumPass !== undefined ? data.premiumPass : old.premiumPass;
      const finalPremiumPrice = Number(data.premiumPrice ?? old.premiumPrice);
      if (finalPremiumPass === true && finalPremiumPrice > 0 && finalEventPass !== true) throw new Error("PREMIUM_REQUIRES_PASS");
      return tx.event.update({ where: { id }, data });
    });
    await audit(me.id, "UPDATE_EVENT", "EVENT", id, { status: row.status, startsAt: row.startsAt, endsAt: row.endsAt });
    return NextResponse.json(present(row));
  } catch (e) { if (e instanceof Error && e.message === "NOT_FOUND") return NextResponse.json({ error: "Event not found" }, { status: 404 }); return errorResponse(e); }
}

export async function DELETE(r: NextRequest) {
  try {
    const me = await requireAdmin(5);
    const id = new URL(r.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const row = await prisma.$transaction(async tx => {
      const old = await tx.event.findUnique({ where: { id } });
      if (!old) throw new Error("NOT_FOUND");
      if (old.status === "ACTIVE" || old.status === "ENDED") throw new Error("CANNOT_DELETE_LIVE");
      return tx.event.delete({ where: { id } });
    });
    await audit(me.id, "DELETE_EVENT", "EVENT", id, { name: row.name });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (e instanceof Error && e.message === "CANNOT_DELETE_LIVE") return NextResponse.json({ error: "Active or ended events must be cancelled instead of deleted" }, { status: 409 });
    return errorResponse(e);
  }
}
