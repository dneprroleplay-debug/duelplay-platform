import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, audit } from "@/lib/admin";
import { normalizeCosmeticType, validateCosmeticMetadata, validateCosmeticPrice } from "@/lib/cosmetic-shop";
import { validateCollectionRequirements } from "@/lib/collection-policy";

const MAX_ITEM_NAME = 100;
const MAX_ITEM_SLUG = 80;
const MAX_IMAGE_URL = 2000;
const MAX_METADATA_BYTES = 16_384;

function cleanItem(body: any) {
  const slug = String(body.slug ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > MAX_ITEM_SLUG) throw new Error("INVALID");
  if (!name || name.length > MAX_ITEM_NAME) throw new Error("INVALID");
  const price = validateCosmeticPrice(body.price);
  if (price > 100_000) throw new Error("INVALID");
  const itemType = normalizeCosmeticType(body.itemType ?? body.type ?? "COSMETIC");
  const imageUrl = body.imageUrl == null ? null : String(body.imageUrl).trim();
  if (imageUrl && imageUrl.length > MAX_IMAGE_URL) throw new Error("INVALID");
  const metadata = validateCosmeticMetadata(body.metadata);
  if (metadata && Buffer.byteLength(JSON.stringify(metadata), "utf8") > MAX_METADATA_BYTES) throw new Error("INVALID");
  return { slug, name, type: itemType, price, imageUrl: imageUrl || null, metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null, active: body.active !== false };
}

export async function GET() {
  await requireAdmin(5);
  const [items, collections, missions, achievements] = await Promise.all([
    prisma.cosmeticItem.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.collection.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.mission.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.achievement.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  return NextResponse.json({ items: items.map(x => ({ ...x, price: Number(x.price) })), collections, missions, achievements });
}

export async function POST(request: NextRequest) {
  const me = await requireAdmin(5);
  const body = await request.json().catch(() => ({}));
  const type = String(body.type || "");
  if (!["ITEM", "COLLECTION", "MISSION", "ACHIEVEMENT"].includes(type)) return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
  try {
    let row: any;
    if (type === "ITEM") {
      const item = cleanItem(body);
      const existing = await prisma.cosmeticItem.findUnique({ where: { slug: item.slug }, select: { id: true } });
      if (existing) throw new Error("SLUG_EXISTS");
      row = await prisma.cosmeticItem.create({ data: { ...item, metadata: item.metadata ? (item.metadata as Prisma.InputJsonValue) : Prisma.JsonNull } });
    } else if (type === "COLLECTION") {
      const slug = String(body.slug || "").trim().toLowerCase(), name = String(body.name || "").trim();
      if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 || !name || name.length > 120) throw new Error("INVALID");
      const duplicate = await prisma.collection.findUnique({ where: { slug }, select: { id: true } });
      if (duplicate) throw new Error("SLUG_EXISTS");
      const requirements = validateCollectionRequirements(body.requirements);
      const reward = body.reward && typeof body.reward === "object" && !Array.isArray(body.reward) ? body.reward : null;
      row = await prisma.collection.create({ data: { slug, name, description: body.description ? String(body.description).slice(0, 500) : null, requirements, reward, active: body.active !== false } });
    } else if (type === "MISSION") {
      const slug = String(body.slug || "").trim(), name = String(body.name || "").trim(), target = Number(body.target);
      if (!slug || !name || !Number.isInteger(target) || target < 1) throw new Error("INVALID");
      row = await prisma.mission.create({ data: { slug, name, description: String(body.description || ""), type: String(body.missionType || "DAILY"), target, reward: body.reward ?? {}, active: body.active !== false, startsAt: body.startsAt ? new Date(body.startsAt) : null, endsAt: body.endsAt ? new Date(body.endsAt) : null } });
    } else {
      const name = String(body.name || "").trim();
      if (!name) throw new Error("INVALID");
      row = await prisma.achievement.create({ data: { name, description: String(body.description || ""), xpReward: Math.max(0, Number(body.xpReward || 0)), iconUrl: body.iconUrl ? String(body.iconUrl) : null, conditions: body.conditions ?? {} } });
    }
    await audit(me.id, `CREATE_${type}`, "CONTENT", row.id, { name: row.name, slug: row.slug ?? null });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const status = message === "SLUG_EXISTS" ? 409 : message === "NOT_FOUND" ? 404 : 400;
    const error = message === "SLUG_EXISTS" ? "Slug already exists" : message === "NOT_FOUND" ? "Item not found" : message === "INVALID" || message === "INVALID_REQUIREMENTS" ? "Invalid content data" : "Could not create content";
    return NextResponse.json({ error }, { status });
  }
}


export async function PATCH(request: NextRequest) {
  const me = await requireAdmin(5);
  const body = await request.json().catch(() => ({}));
  const type = String(body.type || "");
  const id = String(body.id || "");
  if (!id || !["ITEM", "COLLECTION", "MISSION", "ACHIEVEMENT"].includes(type)) return NextResponse.json({ error: "Invalid content update" }, { status: 400 });
  try {
    let row: any;
    if (type === "ITEM") {
      const current = await prisma.cosmeticItem.findUnique({ where: { id } });
      if (!current) throw new Error("NOT_FOUND");
      const merged = {
        slug: body.slug !== undefined ? body.slug : current.slug,
        name: body.name !== undefined ? body.name : current.name,
        price: body.price !== undefined ? body.price : current.price,
        itemType: body.type !== undefined ? body.type : current.type,
        imageUrl: body.imageUrl !== undefined ? body.imageUrl : current.imageUrl,
        metadata: body.metadata !== undefined ? body.metadata : current.metadata,
        active: body.active !== undefined ? body.active : current.active,
      };
      const clean = cleanItem(merged);
      const duplicate = await prisma.cosmeticItem.findFirst({ where: { slug: clean.slug, id: { not: id } }, select: { id: true } });
      if (duplicate) throw new Error("SLUG_EXISTS");
      row = await prisma.cosmeticItem.update({ where: { id }, data: { ...clean, metadata: clean.metadata ? (clean.metadata as Prisma.InputJsonValue) : Prisma.JsonNull } });
    } else if (type === "COLLECTION") {
      const current = await prisma.collection.findUnique({ where: { id } });
      if (!current) throw new Error("NOT_FOUND");
      const data: any = {};
      if (body.name !== undefined) { const name = String(body.name).trim(); if (!name || name.length > 120) throw new Error("INVALID"); data.name = name; }
      if (body.description !== undefined) data.description = body.description ? String(body.description).slice(0, 500) : null;
      if (body.requirements !== undefined) data.requirements = validateCollectionRequirements(body.requirements);
      if (body.reward !== undefined) { if (body.reward !== null && (typeof body.reward !== "object" || Array.isArray(body.reward))) throw new Error("INVALID"); data.reward = body.reward; }
      if (body.active !== undefined) data.active = Boolean(body.active);
      row = await prisma.collection.update({ where: { id }, data });
    } else if (type === "MISSION") {
      const data: any = {};
      for (const k of ["name", "description", "type", "reward"]) if (body[k] !== undefined) data[k] = k === "reward" ? body[k] : String(body[k]);
      if (body.target !== undefined) { const n = Number(body.target); if (!Number.isInteger(n) || n < 1) throw new Error("INVALID"); data.target = n; }
      if (body.startsAt !== undefined) data.startsAt = body.startsAt ? new Date(body.startsAt) : null;
      if (body.endsAt !== undefined) data.endsAt = body.endsAt ? new Date(body.endsAt) : null;
      if (body.active !== undefined) data.active = Boolean(body.active);
      row = await prisma.mission.update({ where: { id }, data });
    } else {
      const data: any = {};
      for (const k of ["name", "description", "iconUrl", "conditions"]) if (body[k] !== undefined) data[k] = ["conditions"].includes(k) ? body[k] : String(body[k]);
      if (body.xpReward !== undefined) { const n = Number(body.xpReward); if (!Number.isInteger(n) || n < 0) throw new Error("INVALID"); data.xpReward = n; }
      row = await prisma.achievement.update({ where: { id }, data });
    }
    await audit(me.id, `UPDATE_${type}`, "CONTENT", id, body);
    return NextResponse.json(row);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const status = message === "SLUG_EXISTS" ? 409 : message === "NOT_FOUND" ? 404 : 400;
    const error = message === "SLUG_EXISTS" ? "Slug already exists" : message === "NOT_FOUND" ? "Item not found" : message === "INVALID" || message === "INVALID_REQUIREMENTS" ? "Invalid content data" : "Could not update content";
    return NextResponse.json({ error }, { status });
  }
}


export async function DELETE(request: NextRequest) {
  const me = await requireAdmin(5);
  const body = await request.json().catch(() => ({}));
  const type = String(body.type || "");
  const id = String(body.id || "");
  if (type !== "ITEM" || !id) return NextResponse.json({ error: "Invalid item deletion" }, { status: 400 });
  try {
    const item = await prisma.cosmeticItem.findUnique({ where: { id }, include: { _count: { select: { purchases: true } } } });
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    if (item._count.purchases > 0) return NextResponse.json({ error: "ITEM_HAS_PURCHASES" }, { status: 409 });
    await prisma.cosmeticItem.delete({ where: { id } });
    await audit(me.id, "DELETE_ITEM", "COSMETIC_ITEM", id, { slug: item.slug, name: item.name });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not delete item" }, { status: 409 });
  }
}
