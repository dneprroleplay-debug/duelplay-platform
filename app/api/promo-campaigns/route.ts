import { getFeatureFlag } from "@/lib/feature-flags";
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, audit } from '@/lib/admin';

function date(value: unknown) { const d = new Date(String(value ?? '')); return Number.isFinite(d.getTime()) ? d : null; }
function number(value: unknown, fallback: number) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }

export async function GET() {
  if (!(await getFeatureFlag("PROMOS", false))) return NextResponse.json({ error: "Promotions are temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  await requireAdmin(5);
  return NextResponse.json(await prisma.promoCampaign.findMany({ orderBy: { createdAt: 'desc' } }));
}

export async function POST(r: NextRequest) {
  if (!(await getFeatureFlag("PROMOS", false))) return NextResponse.json({ error: "Promotions are temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  const me = await requireAdmin(5);
  const b = await r.json().catch(() => ({}));
  const name = String(b.name || '').trim();
  const startsAt = date(b.startsAt); const endsAt = date(b.endsAt);
  const multiplier = number(b.multiplier, 1);
  const usageLimit = b.limit == null ? null : number(b.limit, -1);
  const maxPayout = b.maxPayout == null ? null : number(b.maxPayout, -1);
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });
  if (!startsAt || !endsAt || endsAt <= startsAt) return NextResponse.json({ error: 'Invalid campaign dates' }, { status: 400 });
  if (multiplier < 1) return NextResponse.json({ error: 'Multiplier must be >= 1' }, { status: 400 });
  if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) return NextResponse.json({ error: 'Invalid usage limit' }, { status: 400 });
  if (maxPayout !== null && maxPayout < 0) return NextResponse.json({ error: 'Invalid max payout' }, { status: 400 });
  const status = String(b.status || (startsAt <= new Date() ? 'ACTIVE' : 'SCHEDULED')).toUpperCase();
  if (!['DRAFT','SCHEDULED','ACTIVE','PAUSED','ENDED'].includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  const row = await prisma.promoCampaign.create({ data: { name, type: String(b.type || 'MULTIPLIER'), startsAt, endsAt, multiplier, usageLimit, maxPayout, conditions: b.conditions || null, status } });
  await audit(me.id, 'CREATE_PROMO_CAMPAIGN', 'PROMO_CAMPAIGN', row.id, { name, status });
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(r: NextRequest) {
  if (!(await getFeatureFlag("PROMOS", false))) return NextResponse.json({ error: "Promotions are temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  const me = await requireAdmin(5);
  const b = await r.json().catch(() => ({}));
  const id = String(b.id || ''); if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const data: Record<string, unknown> = {};
  for (const k of ['name','type','conditions']) if (b[k] !== undefined) data[k] = b[k];
  if (b.startsAt !== undefined) { const d = date(b.startsAt); if (!d) return NextResponse.json({ error: 'Invalid startsAt' }, { status: 400 }); data.startsAt = d; }
  if (b.endsAt !== undefined) { const d = date(b.endsAt); if (!d) return NextResponse.json({ error: 'Invalid endsAt' }, { status: 400 }); data.endsAt = d; }
  if (b.multiplier !== undefined) { const n = number(b.multiplier, -1); if (n < 1) return NextResponse.json({ error: 'Invalid multiplier' }, { status: 400 }); data.multiplier = n; }
  if (b.limit !== undefined) { const n = b.limit == null ? null : number(b.limit, -1); if (n !== null && (!Number.isInteger(n) || n < 1)) return NextResponse.json({ error: 'Invalid usage limit' }, { status: 400 }); data.usageLimit = n; }
  if (b.maxPayout !== undefined) { const n = b.maxPayout == null ? null : number(b.maxPayout, -1); if (n !== null && n < 0) return NextResponse.json({ error: 'Invalid max payout' }, { status: 400 }); data.maxPayout = n; }
  if (b.status !== undefined) { const status = String(b.status).toUpperCase(); if (!['DRAFT','SCHEDULED','ACTIVE','PAUSED','ENDED'].includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 }); data.status = status; }
  const current = await prisma.promoCampaign.findUnique({ where: { id } }); if (!current) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  const starts = (data.startsAt as Date | undefined) ?? current.startsAt; const ends = (data.endsAt as Date | undefined) ?? current.endsAt;
  if (ends <= starts) return NextResponse.json({ error: 'Invalid campaign dates' }, { status: 400 });
  const row = await prisma.promoCampaign.update({ where: { id }, data: data as never });
  await audit(me.id, 'UPDATE_PROMO_CAMPAIGN', 'PROMO_CAMPAIGN', id, { changes: data });
  return NextResponse.json(row);
}
