import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, audit } from "@/lib/admin";

const PLACEMENTS = new Set(["HOME", "HOME_HERO", "HOME_MID", "HOME_BOTTOM"]);

function parseDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function validUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2048) return false;
  if (raw.startsWith("/")) return true;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function activeWhere(now: Date, placement?: string) {
  return {
    active: true,
    ...(placement ? { placement } : {}),
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const adminView = params.get("admin") === "1";

  if (adminView) {
    await requireAdmin(5);
    return NextResponse.json(await prisma.banner.findMany({ orderBy: [{ placement: "asc" }, { createdAt: "desc" }] }));
  }

  const placement = params.get("placement")?.trim().toUpperCase();
  if (placement && !PLACEMENTS.has(placement)) {
    return NextResponse.json({ error: "Invalid placement" }, { status: 400 });
  }

  const rows = await prisma.banner.findMany({
    where: activeWhere(new Date(), placement || undefined),
    orderBy: [{ createdAt: "desc" }],
    take: 20,
  });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const me = await requireAdmin(5);
  const body = await request.json();
  const title = String(body.title ?? "").trim();
  const imageUrl = String(body.imageUrl ?? "").trim();
  const placement = String(body.placement ?? "HOME").trim().toUpperCase();
  const startsAt = parseDate(body.startsAt);
  const endsAt = parseDate(body.endsAt);

  if (!title || title.length > 160 || !validUrl(imageUrl) || !PLACEMENTS.has(placement)) {
    return NextResponse.json({ error: "Invalid banner" }, { status: 400 });
  }
  if (startsAt === undefined || endsAt === undefined || (startsAt && endsAt && endsAt <= startsAt)) {
    return NextResponse.json({ error: "Invalid banner dates" }, { status: 400 });
  }

  const row = await prisma.banner.create({
    data: { title, imageUrl, placement, startsAt, endsAt, active: body.active !== false },
  });
  await audit(me.id, "CREATE_BANNER", "BANNER", row.id, { title, placement });
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const me = await requireAdmin(5);
  const body = await request.json();
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const old = await prisma.banner.findUnique({ where: { id } });
  if (!old) return NextResponse.json({ error: "Banner not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title || title.length > 160) return NextResponse.json({ error: "Invalid title" }, { status: 400 });
    data.title = title;
  }
  if (body.imageUrl !== undefined) {
    const imageUrl = String(body.imageUrl).trim();
    if (!validUrl(imageUrl)) return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
    data.imageUrl = imageUrl;
  }
  if (body.placement !== undefined) {
    const placement = String(body.placement).trim().toUpperCase();
    if (!PLACEMENTS.has(placement)) return NextResponse.json({ error: "Invalid placement" }, { status: 400 });
    data.placement = placement;
  }
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.startsAt !== undefined) {
    const value = parseDate(body.startsAt);
    if (value === undefined) return NextResponse.json({ error: "Invalid startsAt" }, { status: 400 });
    data.startsAt = value;
  }
  if (body.endsAt !== undefined) {
    const value = parseDate(body.endsAt);
    if (value === undefined) return NextResponse.json({ error: "Invalid endsAt" }, { status: 400 });
    data.endsAt = value;
  }
  const startsAt = (data.startsAt as Date | undefined) ?? old.startsAt;
  const endsAt = (data.endsAt as Date | undefined) ?? old.endsAt;
  if (startsAt && endsAt && endsAt <= startsAt) return NextResponse.json({ error: "Invalid banner dates" }, { status: 400 });

  const row = await prisma.banner.update({ where: { id }, data });
  await audit(me.id, "UPDATE_BANNER", "BANNER", id, { old, new: data });
  return NextResponse.json(row);
}

export async function DELETE(request: NextRequest) {
  const me = await requireAdmin(5);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const old = await prisma.banner.findUnique({ where: { id } });
  if (!old) return NextResponse.json({ error: "Banner not found" }, { status: 404 });
  await prisma.banner.delete({ where: { id } });
  await audit(me.id, "DELETE_BANNER", "BANNER", id, { title: old.title, placement: old.placement });
  return NextResponse.json({ ok: true });
}
