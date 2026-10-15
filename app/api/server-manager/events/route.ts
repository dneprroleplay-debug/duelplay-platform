import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { cleanTechnicalDetails, cleanTechnicalText, isTechnicalIdentifier } from "@/lib/server-technical-events";
import { isServerManagerRequest } from "../auth";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;
const SEVERITIES = new Set(["DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL", "FATAL"]);
const INCIDENT_SEVERITIES = new Set(["ERROR", "CRITICAL", "FATAL"]);

export async function POST(request: NextRequest) {
  if (!isServerManagerRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ip = getClientIp(request);
  try {
    await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "SERVER_TECHNICAL_EVENT", 120, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    throw error;
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return NextResponse.json({ error: "EVENT_TOO_LARGE" }, { status: 413 });
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const body = input as Record<string, unknown>;
  const eventId = body.eventId;
  const serverName = body.serverId;
  const source = body.source;
  const category = body.category;
  const severity = typeof body.severity === "string" ? body.severity.toUpperCase() : "";
  const message = typeof body.message === "string" ? cleanTechnicalText(body.message, 500) : "";
  const occurred = typeof body.occurredAt === "string" ? new Date(body.occurredAt) : new Date(NaN);
  if (!isTechnicalIdentifier(eventId) || !isTechnicalIdentifier(serverName) || !isTechnicalIdentifier(source) || !isTechnicalIdentifier(category) || !SEVERITIES.has(severity) || !message || !Number.isFinite(occurred.getTime())) {
    return NextResponse.json({ error: "INVALID_EVENT" }, { status: 400 });
  }
  const now = new Date();
  if (occurred.getTime() < now.getTime() - 7 * 24 * 60 * 60_000 || occurred.getTime() > now.getTime() + 5 * 60_000) {
    return NextResponse.json({ error: "EVENT_TIME_OUT_OF_RANGE" }, { status: 400 });
  }
  const correlationId = isTechnicalIdentifier(body.correlationId) ? body.correlationId : null;
  const matchId = typeof body.matchId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.matchId) ? body.matchId : null;
  const result = typeof body.result === "string" ? cleanTechnicalText(body.result, 64) || null : null;
  const details = cleanTechnicalDetails(body.details);

  try {
    const server = await prisma.gameServer.findUnique({ where: { name: serverName }, select: { name: true } });
    if (!server) return NextResponse.json({ error: "UNKNOWN_SERVER" }, { status: 404 });

    const existing = await prisma.serverTechnicalEvent.findUnique({ where: { eventId }, select: { id: true } });
    if (existing) return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });

    const createIncident = INCIDENT_SEVERITIES.has(severity);
    const dedupeKey = createIncident ? createHash("sha256").update(`${serverName}\0${source}\0${category}`).digest("hex") : null;
    const stored = await prisma.$transaction(async tx => {
      const incident = dedupeKey ? await tx.serverIncident.upsert({
        where: { dedupeKey },
        create: { dedupeKey, serverName, category, severity, title: `${source}: ${category}`, message, firstSeenAt: occurred, lastSeenAt: occurred },
        update: { occurrences: { increment: 1 }, lastSeenAt: occurred, severity, message, status: "OPEN", acknowledgedAt: null, acknowledgedById: null, resolvedAt: null, resolution: Prisma.DbNull },
        select: { id: true },
      }) : null;
      return tx.serverTechnicalEvent.create({ data: { eventId, serverName, source, category, severity, message, details: details ? details as Prisma.InputJsonValue : Prisma.DbNull, correlationId, matchId, result, occurredAt: occurred, incidentId: incident?.id ?? null }, select: { id: true } });
    });
    return NextResponse.json({ ok: true, eventId: stored.id }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    console.error("[DuelPlay] technical event ingest failed", error);
    return NextResponse.json({ error: "EVENT_INGEST_FAILED" }, { status: 500 });
  }
}
