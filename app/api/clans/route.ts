import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { enforceRateLimit } from "@/lib/rate-limit";
import { Prisma } from "@prisma/client";

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]{1,23}$/u;
const TAG_RE = /^[A-Z0-9]{2,6}$/;

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const clan = await prisma.clan.findUnique({
      where: { id },
      include: {
        members: {
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          include: { user: { select: { id: true, nickname: true, avatarUrl: true, steamAvatarUrl: true, level: true, status: true } } },
        },
        warsOne: { take: 5, orderBy: { createdAt: "desc" } },
        warsTwo: { take: 5, orderBy: { createdAt: "desc" } },
      },
    });
    if (!clan) return error("Clan not found", 404);
    return NextResponse.json(clan);
  }

  const mine = new URL(request.url).searchParams.get("mine") === "1";
  if (mine) {
    const me = await getCurrentUser();
    if (!me) return error("Unauthorized", 401);
    const membership = await prisma.clanMember.findFirst({ where: { userId: me.id }, include: { clan: true } });
    return NextResponse.json(membership);
  }

  const clans = await prisma.clan.findMany({
    orderBy: [{ rating: "desc" }, { wins: "desc" }, { createdAt: "asc" }],
    take: 100,
    include: { members: { include: { user: { select: { id: true, nickname: true, avatarUrl: true } } } } },
  });
  return NextResponse.json(clans.map((clan, index) => ({ ...clan, rank: index + 1 })));
}

export async function POST(request: NextRequest) {
  try {
  const me = await getCurrentUser();
  if (!me) return error("Unauthorized", 401);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return error("Invalid JSON"); }
  const action = String(body.action || "create");

  if (action === "create") {
    const name = String(body.name || "").trim().replace(/\s+/g, " ");
    const tag = String(body.tag || "").trim().toUpperCase();
    if (!NAME_RE.test(name) || !TAG_RE.test(tag)) return error("Invalid clan name/tag");
    if (body.logoUrl && String(body.logoUrl).length > 500) return error("Invalid logo URL");

    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:clan-membership'))`;
      await enforceRateLimit(tx, me.id, "CLAN_CREATE", 3, 60 * 60_000);
      const existingMembership = await tx.clanMember.findFirst({ where: { userId: me.id } });
      if (existingMembership) return error("Leave your current clan before creating another one", 409);
      const duplicate = await tx.clan.findFirst({ where: { OR: [{ name }, { tag }] }, select: { id: true } });
      if (duplicate) return error("Clan name or tag is already taken", 409);
      const clan = await tx.clan.create({ data: { name, tag, logoUrl: body.logoUrl ? String(body.logoUrl) : null, creatorId: me.id } });
      await tx.clanMember.create({ data: { clanId: clan.id, userId: me.id, role: "LEADER" } });
      return NextResponse.json(clan, { status: 201 });
    });
  }

  const clanId = String(body.clanId || "");
  if (!clanId) return error("clanId required");

  if (action === "join") {
    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:clan-membership'))`;
      await enforceRateLimit(tx, me.id, "CLAN_JOIN", 10, 60 * 60_000);
      const clan = await tx.clan.findUnique({ where: { id: clanId }, select: { id: true } });
      if (!clan) return error("Clan not found", 404);
      const current = await tx.clanMember.findFirst({ where: { userId: me.id } });
      if (current) return error("You are already in a clan", 409);
      const memberCount = await tx.clanMember.count({ where: { clanId } });
      if (memberCount >= 20) return error("Clan is full", 409);
      const member = await tx.clanMember.create({ data: { clanId, userId: me.id, role: "MEMBER" } });
      return NextResponse.json(member, { status: 201 });
    });
  }

  if (action === "leave") {
    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:clan-membership'))`;
      const membership = await tx.clanMember.findUnique({ where: { clanId_userId: { clanId, userId: me.id } } });
      if (!membership) return error("You are not a member", 404);
      if (membership.role === "LEADER") {
        const successor = await tx.clanMember.findFirst({ where: { clanId, userId: { not: me.id } }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
        if (successor) {
          await tx.clanMember.update({ where: { id: successor.id }, data: { role: "LEADER" } });
        } else {
          await tx.clan.delete({ where: { id: clanId } });
          return NextResponse.json({ ok: true, disbanded: true });
        }
      }
      await tx.clanMember.delete({ where: { id: membership.id } });
      return NextResponse.json({ ok: true });
    });
  }

  if (action === "kick" || action === "promote" || action === "demote") {
    const targetId = String(body.userId || "");
    if (!targetId || targetId === me.id) return error("Invalid userId");
    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:clan-membership'))`;
      const actor = await tx.clanMember.findUnique({ where: { clanId_userId: { clanId, userId: me.id } } });
      if (!actor || !["LEADER", "OFFICER"].includes(actor.role)) return error("Leader or officer required", 403);
      const target = await tx.clanMember.findUnique({ where: { clanId_userId: { clanId, userId: targetId } } });
      if (!target) return error("Member not found", 404);
      if (action === "kick") {
        if (target.role === "LEADER") return error("Leader cannot be kicked", 403);
        if (actor.role === "OFFICER" && target.role === "OFFICER") return error("Officer cannot kick another officer", 403);
        await tx.clanMember.delete({ where: { id: target.id } });
        return NextResponse.json({ ok: true });
      }
      if (actor.role !== "LEADER") return error("Leader required", 403);
      if (action === "promote") {
        if (target.role !== "MEMBER") return error("Only members can be promoted");
        await tx.clanMember.update({ where: { id: target.id }, data: { role: "OFFICER" } });
      } else {
        if (target.role !== "OFFICER") return error("Only officers can be demoted");
        await tx.clanMember.update({ where: { id: target.id }, data: { role: "MEMBER" } });
      }
      return NextResponse.json({ ok: true });
    });
  }

  return error("Unsupported action");
  } catch (e) {
    if (e instanceof Error && e.message === "RATE_LIMITED") return error("Too many clan actions. Try again later.", 429);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return error("Clan name or tag is already taken", 409);
    console.error("Clan API error", e);
    return error("Clan operation failed", 500);
  }
}
