import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/request-meta";
import { isFreshServerManagerRequest } from "../auth";
import {
  assertCs2RecoverySnapshot,
  assertFailedCs2UpdateRun,
  cs2RecoveryIdForRun,
  cs2RecoverySettingKey,
  validateCs2RecoveryRunId,
} from "@/lib/cs2-update-recovery.mjs";

export const runtime = "nodejs";

const PHASE_ORDER = ["PREPARED", "MARKER_REFRESHED", "STATUS_UPDATED", "COMPLETED"] as const;
type RecoveryPhase = typeof PHASE_ORDER[number];
type MarkerIdentity = { dev: number; ino: number; mtimeMs: number; size: number };
type MarkerCleanupReceipt = {
  recoveryId: string; phase: "STATUS_UPDATED"; nonce: string; marker: MarkerIdentity;
  executorPid: number; disposition: "UNLINKED" | "ABSENT_ON_RETRY"; observedAt: string;
};

type RecoveryLedger = {
  version: 1;
  recoveryId: string;
  runId: string;
  phase: RecoveryPhase;
  markerOwnershipToken: string;
  startedAt: string;
  updatedAt: string;
  markerPid?: number;
  markerDev?: number;
  markerIno?: number;
  markerMtimeMs?: number;
  markerSize?: number;
  markerCleanupNonce?: string;
  markerCleanupReceipt?: MarkerCleanupReceipt;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMarkerIdentity(value: unknown): value is MarkerIdentity {
  if (!isRecord(value)) return false;
  return Number.isSafeInteger(value.dev) && Number(value.dev) >= 0
    && Number.isSafeInteger(value.ino) && Number(value.ino) > 0
    && typeof value.mtimeMs === "number" && Number.isFinite(value.mtimeMs) && value.mtimeMs >= 0
    && Number.isSafeInteger(value.size) && Number(value.size) >= 0;
}

function parseMarkerCleanupReceipt(value: unknown, recoveryId: string): MarkerCleanupReceipt | null {
  if (!isRecord(value) || value.recoveryId !== recoveryId || value.phase !== "STATUS_UPDATED"
    || typeof value.nonce !== "string" || !/^[0-9a-f]{64}$/.test(value.nonce)
    || !isMarkerIdentity(value.marker)
    || !Number.isSafeInteger(value.executorPid) || Number(value.executorPid) <= 0
    || !["UNLINKED", "ABSENT_ON_RETRY"].includes(String(value.disposition))
    || typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt))) return null;
  return value as unknown as MarkerCleanupReceipt;
}

function validateMarkerEvidence(body: Record<string, unknown>, now: Date, expectedOwnershipToken: string) {
  const markerPid = body.markerPid;
  const markerMtimeMs = body.markerMtimeMs;
  const marker = { dev: body.markerDev, ino: body.markerIno, mtimeMs: markerMtimeMs, size: body.markerSize };
  if (body.markerOwnershipToken !== expectedOwnershipToken
    || typeof body.markerOwnershipToken !== "string" || !/^[0-9a-f]{64}$/.test(body.markerOwnershipToken)
    || !Number.isSafeInteger(markerPid) || Number(markerPid) <= 0
    || !isMarkerIdentity(marker)
    || typeof markerMtimeMs !== "number" || Math.abs(now.getTime() - markerMtimeMs) > 60_000) {
    throw new Error("CS2_RECOVERY_MARKER_EVIDENCE_INVALID");
  }
  return { markerPid: Number(markerPid), ...marker } as MarkerIdentity & { markerPid: number };
}

function markerReceiptMatchesLedger(receipt: MarkerCleanupReceipt, ledger: RecoveryLedger, nowMs: number) {
  const observedAtMs = Date.parse(receipt.observedAt);
  return Boolean(ledger.markerCleanupNonce && receipt.nonce === ledger.markerCleanupNonce
    && receipt.recoveryId === ledger.recoveryId && receipt.phase === "STATUS_UPDATED"
    && receipt.marker.dev === ledger.markerDev && receipt.marker.ino === ledger.markerIno
    && receipt.marker.mtimeMs === ledger.markerMtimeMs && receipt.marker.size === ledger.markerSize
    && Number.isFinite(observedAtMs) && observedAtMs <= nowMs + 30_000 && nowMs - observedAtMs <= 60_000);
}

function parseLedger(value: unknown, runId: string): RecoveryLedger | null {
  if (!isRecord(value) || value.version !== 1 || value.runId !== runId
    || typeof value.markerOwnershipToken !== "string" || !/^[0-9a-f]{64}$/.test(value.markerOwnershipToken)
    || value.recoveryId !== cs2RecoveryIdForRun(runId)
    || !PHASE_ORDER.includes(value.phase as RecoveryPhase)
    || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  const phaseIndex = PHASE_ORDER.indexOf(value.phase as RecoveryPhase);
  if (phaseIndex >= PHASE_ORDER.indexOf("MARKER_REFRESHED")) {
    if (!isMarkerIdentity({ dev: value.markerDev, ino: value.markerIno, mtimeMs: value.markerMtimeMs, size: value.markerSize })
      || !Number.isSafeInteger(value.markerPid) || Number(value.markerPid) <= 0) return null;
  }
  if (phaseIndex >= PHASE_ORDER.indexOf("STATUS_UPDATED")
    && (typeof value.markerCleanupNonce !== "string" || !/^[0-9a-f]{64}$/.test(value.markerCleanupNonce))) return null;
  if (value.phase === "COMPLETED" && !parseMarkerCleanupReceipt(value.markerCleanupReceipt, value.recoveryId as string)) return null;
  return value as unknown as RecoveryLedger;
}

function statusCode(code: string) {
  if (["INVALID_RECOVERY_RUN_ID", "INVALID_RECOVERY_ACTION", "INVALID_RECOVERY_BODY"].includes(code)) return 400;
  if (code === "FAILED_UPDATE_RUN_NOT_FOUND") return 404;
  if (code.startsWith("RECOVERY_") || code.startsWith("CS2_") || code.startsWith("ACTIVE_")
    || code.startsWith("MAINTENANCE_") || code.startsWith("SYNC_MARKER_")
    || code.startsWith("OLD_UPDATE_") || code.startsWith("UNEXPECTED_")
    || code.startsWith("PERSISTED_") || code.startsWith("FAILED_UPDATE_STATUS_")) return 409;
  return 500;
}

async function readLedger(runId: string) {
  const row = await prisma.siteSettings.findUnique({
    where: { key: cs2RecoverySettingKey(runId) },
    select: { value: true, updatedAt: true },
  });
  return parseLedger(row?.value, runId);
}

export async function GET(request: Request) {
  if (!(await isFreshServerManagerRequest(request))) {
    return NextResponse.json({ errorCode: "UNAUTHORIZED_OR_EXPIRED" }, { status: 401 });
  }
  let runId: string;
  try {
    runId = validateCs2RecoveryRunId(new URL(request.url).searchParams.get("runId") ?? "");
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_RECOVERY_RUN_ID";
    return NextResponse.json({ errorCode: code }, { status: 400 });
  }
  const ledger = await readLedger(runId);
  return NextResponse.json({
    ok: true,
    recoveryId: cs2RecoveryIdForRun(runId),
    runId,
    phase: ledger?.phase ?? "NOT_STARTED",
    ledger,
  }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}

async function loadDbState(tx: Prisma.TransactionClient, runId: string) {
  const [maintenance, activeMatches, servers, updateStatusRow, run, ledgerRow] = await Promise.all([
    tx.featureFlag.findUnique({ where: { key: "MAINTENANCE_MODE" }, select: { id: true, enabled: true } }),
    tx.match.count({ where: { status: { in: ["STARTING", "LIVE"] } } }),
    tx.gameServer.findMany({
      select: { name: true, status: true, matchId: true, processId: true, lastHeartbeat: true, metadata: true },
      orderBy: { createdAt: "asc" },
    }),
    tx.siteSettings.findUnique({ where: { key: "CS2_UPDATE_STATUS" }, select: { id: true, value: true } }),
    tx.cs2UpdateRun.findUnique({ where: { id: runId } }),
    tx.siteSettings.findUnique({ where: { key: cs2RecoverySettingKey(runId) }, select: { id: true, value: true } }),
  ]);
  const ledger = parseLedger(ledgerRow?.value, runId);
  if (ledgerRow && !ledger) throw new Error("RECOVERY_LEDGER_INVALID");
  const nowMs = Date.now();
  const snapshot = {
    maintenance: maintenance?.enabled ?? false,
    activeMatches,
    updateStatus: isRecord(updateStatusRow?.value) ? updateStatusRow.value : null,
    servers: servers.map(server => {
      const metadata = isRecord(server.metadata) ? server.metadata : {};
      return {
        name: server.name,
        status: server.status,
        matchId: server.matchId,
        processId: server.processId,
        lastHeartbeat: server.lastHeartbeat?.toISOString() ?? null,
        heartbeatFresh: Boolean(server.lastHeartbeat
          && nowMs - server.lastHeartbeat.getTime() >= 0
          && nowMs - server.lastHeartbeat.getTime() <= 30_000),
        managerReady: metadata.managerReady === true,
        gameProcessReady: metadata.gameProcessReady === true,
        gameProcessStatus: metadata.gameProcessStatus ?? "UNKNOWN",
        gameProcessPid: metadata.gameProcessPid ?? null,
      };
    }),
  };
  return { maintenance, activeMatches, servers, updateStatusRow, run, ledger, ledgerRow, snapshot };
}

function validateDbState(state: Awaited<ReturnType<typeof loadDbState>>, runId: string) {
  if (!state.run) throw new Error("FAILED_UPDATE_RUN_NOT_FOUND");
  assertFailedCs2UpdateRun(state.run, runId);
  const phase = state.ledger?.phase ?? "NOT_STARTED";
  assertCs2RecoverySnapshot(state.snapshot, {
    nowMs: Date.now(), phase, recoveryId: cs2RecoveryIdForRun(runId), runId,
  });
  // The recovery is only for a completed install whose persisted run evidence agrees.
  if (state.run.publicBuildId !== state.run.installedBuildIdAfter || !state.run.serverVersionAfter) {
    throw new Error("PERSISTED_BUILD_EVIDENCE_MISSING");
  }
  return phase;
}

function audit(tx: Prisma.TransactionClient, request: Request, runId: string, recoveryId: string,
  action: string, phase: string, reason: string, payload: Record<string, unknown> = {}) {
  return tx.auditLog.create({
    data: {
      action,
      targetType: "PLATFORM",
      targetId: runId,
      ipAddress: getClientIp(request),
      userAgent: (request.headers.get("user-agent") || "duelplay-cs2-controlled-recovery").slice(0, 500),
      requestId: request.headers.get("x-duelplay-request-nonce")?.slice(0, 128) ?? null,
      result: "SUCCESS",
      reason: reason.slice(0, 1000),
      payload: { recoveryId, runId, phase, ...payload } as Prisma.InputJsonValue,
    },
  });
}

async function updateLedger(tx: Prisma.TransactionClient, key: string, row: { id: string } | null,
  ledger: RecoveryLedger) {
  const value = ledger as unknown as Prisma.InputJsonValue;
  if (row) return tx.siteSettings.update({ where: { key }, data: { value } });
  return tx.siteSettings.create({ data: { key, value, description: "CS2 controlled recovery journal" } });
}

export async function POST(request: Request) {
  if (!(await isFreshServerManagerRequest(request))) {
    return NextResponse.json({ errorCode: "UNAUTHORIZED_OR_EXPIRED" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!isRecord(parsed)) return NextResponse.json({ errorCode: "INVALID_RECOVERY_BODY" }, { status: 400 });
    body = parsed;
  } catch {
    return NextResponse.json({ errorCode: "INVALID_RECOVERY_BODY" }, { status: 400 });
  }

  let runId: string;
  try {
    runId = validateCs2RecoveryRunId(typeof body.runId === "string" ? body.runId : "");
  } catch {
    return NextResponse.json({ errorCode: "INVALID_RECOVERY_RUN_ID" }, { status: 400 });
  }
  const recoveryId = cs2RecoveryIdForRun(runId);
  if (body.recoveryId !== recoveryId) {
    return NextResponse.json({ errorCode: "RECOVERY_ID_MISMATCH" }, { status: 409 });
  }
  const action = body.action;
  if (!["prepare", "marker-refreshed", "complete", "finalize"].includes(String(action))) {
    return NextResponse.json({ errorCode: "INVALID_RECOVERY_ACTION" }, { status: 400 });
  }
  if (action === "finalize" && !parseMarkerCleanupReceipt(body.markerReceipt, recoveryId)) {
    return NextResponse.json({ errorCode: "SYNC_MARKER_CLEANUP_RECEIPT_INVALID" }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async tx => {
      // Share the existing maintenance/match operation lock and add a per-run recovery lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:maintenance-match-ops'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:cs2-update-recovery'), hashtext(${runId}))`;

      const state = await loadDbState(tx, runId);
      const phase = validateDbState(state, runId);
      const key = cs2RecoverySettingKey(runId);
      const now = new Date();
      const existing = state.ledger;

      if (action === "prepare") {
        if (!existing) {
          const ledger: RecoveryLedger = {
            version: 1, recoveryId, runId, phase: "PREPARED",
            markerOwnershipToken: randomBytes(32).toString("hex"),
            startedAt: now.toISOString(), updatedAt: now.toISOString(),
          };
          await updateLedger(tx, key, state.ledgerRow, ledger);
          await audit(tx, request, runId, recoveryId, "CS2_UPDATE_RECOVERY_PREPARED", ledger.phase,
            "Prepared controlled recovery while maintenance remains enabled; original FAILED run is preserved.");
          return { phase: ledger.phase, ledger };
        }
        return { phase: existing.phase, ledger: existing, alreadyApplied: true };
      }

      if (!existing) throw new Error("RECOVERY_NOT_PREPARED");

      if (action === "marker-refreshed") {
        const evidence = validateMarkerEvidence(body, now, existing.markerOwnershipToken);
        if (phase === "PREPARED") {
          const ledger: RecoveryLedger = {
            ...existing, phase: "MARKER_REFRESHED", updatedAt: now.toISOString(),
            markerPid: evidence.markerPid,
            markerDev: evidence.dev,
            markerIno: evidence.ino,
            markerMtimeMs: evidence.mtimeMs,
            markerSize: evidence.size,
          };
          await updateLedger(tx, key, state.ledgerRow, ledger);
          await audit(tx, request, runId, recoveryId, "CS2_UPDATE_RECOVERY_MARKER_REFRESHED", ledger.phase,
            "Sync marker was atomically refreshed as a recovery-owned marker; maintenance remains enabled.",
            { markerPid: ledger.markerPid ?? null, markerIno: ledger.markerIno ?? null });
          return { phase: ledger.phase, ledger };
        }
        if (phase === "MARKER_REFRESHED") {
          const sameIdentity = existing.markerPid === evidence.markerPid
            && existing.markerDev === evidence.dev && existing.markerIno === evidence.ino
            && existing.markerMtimeMs === evidence.mtimeMs && existing.markerSize === evidence.size;
          if (sameIdentity) return { phase, ledger: existing, alreadyApplied: true };
          const ledger: RecoveryLedger = {
            ...existing, updatedAt: now.toISOString(),
            markerPid: evidence.markerPid,
            markerDev: evidence.dev,
            markerIno: evidence.ino,
            markerMtimeMs: evidence.mtimeMs,
            markerSize: evidence.size,
          };
          await updateLedger(tx, key, state.ledgerRow, ledger);
          await audit(tx, request, runId, recoveryId, "CS2_UPDATE_RECOVERY_MARKER_REBOUND", ledger.phase,
            "A missing recovery-owned marker was recreated and its new identity was recorded before continuing.",
            { markerPid: ledger.markerPid ?? null, markerIno: ledger.markerIno ?? null });
          return { phase: ledger.phase, ledger };
        }
        throw new Error("RECOVERY_PHASE_INVALID");
      }

      if (action === "complete") {
        if (phase === "MARKER_REFRESHED") {
          if (!isMarkerIdentity({ dev: existing.markerDev, ino: existing.markerIno, mtimeMs: existing.markerMtimeMs, size: existing.markerSize }))
            throw new Error("CS2_RECOVERY_MARKER_EVIDENCE_INVALID");
          const globalStatus = {
            status: "SUCCEEDED",
            startedAt: state.run!.startedAt.toISOString(),
            finishedAt: now.toISOString(),
            recoveryType: "CONTROLLED_CS2_STATE_RECOVERY",
            recoveryId,
            recoveredFromRunId: runId,
            publicBuildId: state.run!.publicBuildId,
            installedBuildId: state.run!.installedBuildIdAfter,
            serverVersion: state.run!.serverVersionAfter,
            message: "Updater control-plane state recovered after INVALID_RUN_UPDATE. The original update run remains FAILED; no game files or game processes were changed by recovery.",
          };
          await tx.siteSettings.upsert({
            where: { key: "CS2_UPDATE_STATUS" },
            update: { value: globalStatus, updatedBy: null },
            create: { key: "CS2_UPDATE_STATUS", value: globalStatus, description: "Latest automated CS2 update status", updatedBy: null },
          });
          const ledger: RecoveryLedger = {
            ...existing,
            phase: "STATUS_UPDATED",
            updatedAt: now.toISOString(),
            markerCleanupNonce: randomBytes(32).toString("hex"),
          };
          await updateLedger(tx, key, state.ledgerRow, ledger);
          await audit(tx, request, runId, recoveryId, "CS2_UPDATE_RECOVERY_STATUS_RESTORED", ledger.phase,
            "Global updater status was reconciled; maintenance stays enabled and the recovery marker is still present.",
            { globalStatus: "SUCCEEDED", originalRunStatus: "FAILED" });
          return { phase: ledger.phase, ledger };
        }
        if (phase === "STATUS_UPDATED" || phase === "COMPLETED") {
          return { phase, ledger: existing, alreadyApplied: true };
        }
        throw new Error("RECOVERY_PHASE_INVALID");
      }

      if (action === "finalize") {
        const receipt = parseMarkerCleanupReceipt(body.markerReceipt, recoveryId);
        if (!receipt) throw new Error("SYNC_MARKER_CLEANUP_RECEIPT_INVALID");
        if (phase === "STATUS_UPDATED") {
          if (!markerReceiptMatchesLedger(receipt, existing, now.getTime())) {
            throw new Error("SYNC_MARKER_CLEANUP_RECEIPT_MISMATCH");
          }
          const ledger: RecoveryLedger = {
            ...existing,
            phase: "COMPLETED",
            updatedAt: now.toISOString(),
            markerCleanupReceipt: receipt,
          };
          await updateLedger(tx, key, state.ledgerRow, ledger);
          await audit(tx, request, runId, recoveryId, "CS2_UPDATE_RECOVERY_COMPLETED", ledger.phase,
            "Authenticated recovery executor attested marker cleanup for this recovery ID, STATUS_UPDATED phase, nonce, and recorded marker inode; maintenance remains enabled.",
            { markerAbsent: true, markerDisposition: receipt.disposition, markerIno: receipt.marker.ino, globalStatus: "SUCCEEDED", originalRunStatus: "FAILED" });
          return { phase: ledger.phase, ledger };
        }
        if (phase === "COMPLETED") {
          const saved = existing.markerCleanupReceipt;
          if (!saved || JSON.stringify(saved) !== JSON.stringify(receipt)) {
            throw new Error("SYNC_MARKER_CLEANUP_RECEIPT_MISMATCH");
          }
          return { phase, ledger: existing, alreadyApplied: true };
        }
        throw new Error("RECOVERY_PHASE_INVALID");
      }

      throw new Error("INVALID_RECOVERY_ACTION");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ ok: true, recoveryId, runId, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      return NextResponse.json({ errorCode: "RECOVERY_TRANSACTION_CONFLICT" }, { status: 409 });
    }
    const code = error instanceof Error ? error.message.split(":", 1)[0] : "RECOVERY_FAILED";
    const status = statusCode(code);
    if (status === 500) {
      console.error("[CS2_UPDATE_RECOVERY]", error);
      return NextResponse.json({ errorCode: "RECOVERY_FAILED" }, { status });
    }
    return NextResponse.json({ errorCode: code }, { status });
  }
}
