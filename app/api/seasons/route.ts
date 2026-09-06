import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, audit } from "@/lib/admin";
import { chooseEffectiveSeason, normalizeSeasonEffects, isValidSeasonWindow, SEASON_MODES } from "@/lib/season-policy";

const select = { id:true,name:true,theme:true,startsAt:true,endsAt:true,mode:true,effects:true,active:true,createdAt:true } as const;

function parseDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function jsonResponse(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers || {}) } });
}

export async function GET() {
  const now = new Date();
  const [all, effectiveRows, next] = await Promise.all([
    prisma.season.findMany({ orderBy:[{startsAt:"desc"},{createdAt:"desc"}], take:100, select }),
    prisma.season.findMany({ where:{ mode:{in:["AUTO","MANUAL"]}, startsAt:{lte:now}, endsAt:{gte:now} }, orderBy:[{startsAt:"desc"},{createdAt:"desc"}], take:100, select }),
    prisma.season.findFirst({ where:{ mode:{in:["AUTO","MANUAL"]}, startsAt:{gt:now} }, orderBy:[{startsAt:"asc"},{createdAt:"asc"}], select }),
  ]);
  const effective = chooseEffectiveSeason(effectiveRows as any[], now);
  return jsonResponse({ active: effective, next, all, serverTime: now.toISOString() });
}

export async function POST(r:NextRequest) {
  const me = await requireAdmin(5);
  const b = await r.json();
  const mode = String(b.mode ?? "AUTO") as typeof SEASON_MODES[number];
  if (!SEASON_MODES.includes(mode)) return jsonResponse({error:"Invalid season mode"},{status:400});
  const name = String(b.name ?? "").trim();
  const theme = String(b.theme ?? "").trim();
  const startsAt = parseDate(b.startsAt);
  const endsAt = parseDate(b.endsAt);
  if (!name || name.length > 80 || !theme || theme.length > 80 || !startsAt || !endsAt || !isValidSeasonWindow(startsAt, endsAt)) return jsonResponse({error:"Invalid season data"},{status:400});
  let effects: unknown = null;
  try { effects = normalizeSeasonEffects(b.effects); } catch { return jsonResponse({error:"Invalid effects"},{status:400}); }
  const requestedActive = Boolean(b.active) && mode !== "OFF";
  const row = await prisma.$transaction(async tx => {
    if (requestedActive) await tx.season.updateMany({where:{active:true},data:{active:false}});
    return tx.season.create({data:{name,theme,startsAt,endsAt,mode,effects:effects as any,active:requestedActive},select});
  }, {isolationLevel:"Serializable"});
  await audit(me.id,"CREATE_SEASON","SEASON",row.id,{name:row.name,mode});
  return jsonResponse(row,{status:201});
}

export async function PATCH(r:NextRequest) {
  const me = await requireAdmin(5);
  const b = await r.json();
  const id = String(b.id ?? "");
  if (!id) return jsonResponse({error:"id required"},{status:400});
  const old = await prisma.season.findUnique({where:{id},select});
  if (!old) return jsonResponse({error:"Season not found"},{status:404});
  const data:any = {};
  if (b.name !== undefined) { const v=String(b.name).trim(); if(!v||v.length>80)return jsonResponse({error:"Invalid name"},{status:400}); data.name=v; }
  if (b.theme !== undefined) { const v=String(b.theme).trim(); if(!v||v.length>80)return jsonResponse({error:"Invalid theme"},{status:400}); data.theme=v; }
  if (b.effects !== undefined) { try { data.effects=normalizeSeasonEffects(b.effects); } catch { return jsonResponse({error:"Invalid effects"},{status:400}); } }
  if (b.mode !== undefined) { const v=String(b.mode); if(!SEASON_MODES.includes(v as any))return jsonResponse({error:"Invalid mode"},{status:400}); data.mode=v; if(v==="OFF")data.active=false; }
  // Disabling a season must really disable it. For AUTO seasons the `active` flag
  // is not consulted by the effective-season resolver, so an `active:false`
  // update without changing mode would otherwise leave the scheduled season live.
  if (b.active !== undefined && !Boolean(b.active) && b.mode === undefined) data.mode = "OFF";
  if (b.startsAt !== undefined) { const d=parseDate(b.startsAt); if(!d)return jsonResponse({error:"Invalid startsAt"},{status:400}); data.startsAt=d; }
  if (b.endsAt !== undefined) { const d=parseDate(b.endsAt); if(!d)return jsonResponse({error:"Invalid endsAt"},{status:400}); data.endsAt=d; }
  if (b.active !== undefined) data.active=Boolean(b.active) && (data.mode ?? old.mode) !== "OFF";
  const startsAt=data.startsAt ?? old.startsAt; const endsAt=data.endsAt ?? old.endsAt;
  if(!isValidSeasonWindow(startsAt,endsAt))return jsonResponse({error:"Invalid season dates"},{status:400});
  const row = await prisma.$transaction(async tx => {
    if (data.active) await tx.season.updateMany({where:{active:true,id:{not:id}},data:{active:false}});
    return tx.season.update({where:{id},data,select});
  }, {isolationLevel:"Serializable"});
  await audit(me.id,"UPDATE_SEASON","SEASON",id,{old,new:data});
  return jsonResponse(row);
}

export async function DELETE(r:NextRequest) {
  const me = await requireAdmin(5);
  const id = String(new URL(r.url).searchParams.get("id") ?? "").trim();
  if (id) {
    const row = await prisma.season.findUnique({where:{id},select});
    if (!row) return jsonResponse({error:"Season not found"},{status:404});
    await prisma.season.delete({where:{id}});
    await audit(me.id,"DELETE_SEASON","SEASON",id,{name:row.name,theme:row.theme,active:row.active});
    return jsonResponse({ok:true,deletedId:id});
  }
  await prisma.season.updateMany({where:{active:true},data:{active:false}});
  await audit(me.id,"DISABLE_SEASONS","SEASON",undefined,{});
  return jsonResponse({ok:true});
}
