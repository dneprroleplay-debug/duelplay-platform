import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";
import { withDemoTransaction } from "@/lib/demo-wallet";

const KYIV_TIME_ZONE = "Europe/Kyiv";

type MatchStatus = "CREATING" | "WAITING_FOR_PLAYERS" | "READY" | "STARTING" | "LIVE" | "FINISHED" | "CANCELLED" | "DISPUTED";
type ReservationStatus = "RESERVED" | "CONSUMED" | "RELEASED";

type MatchRow = {
  id: string;
  economyMode: "REAL" | "DEMO";
  status: MatchStatus;
  playerOneId: string;
  playerTwoId: string | null;
};

type SettingsRow = {
  id: string;
  enabled: boolean;
  dailyMatchLimit: number;
  timeZone: string;
};

type ReservationRow = {
  userId: string;
  localDay: string;
  status: ReservationStatus;
};

type UsageRow = { userId: string };

type PolicyTx = Prisma.TransactionClient;
type WalletContext = Parameters<Parameters<typeof withDemoTransaction>[0]>[0];

export type DemoPolicyOperations = {
  getDemoModeSettings(): Promise<{ exists: boolean; enabled: boolean; dailyMatchLimit: number; timeZone: string }>;
  assertDemoUserCanCreateOrJoin(userId: string, action: "CREATE" | "JOIN"): Promise<void>;
  reserveDemoMatchStart(matchId: string, now?: Date): Promise<{ idempotent: boolean; localDay: Date; userIds: string[] }>;
  confirmDemoMatchLive(matchId: string, startedAt?: Date): Promise<{ idempotent: boolean; localDay: Date; userIds: string[] }>;
  releaseDemoMatchReservation(matchId: string, releasedAt?: Date): Promise<{ idempotent: boolean; released: number }>;
};

export type DemoPolicyTransactionContext = WalletContext & { policy: DemoPolicyOperations };

const policyScope = new AsyncLocalStorage<{ token: symbol; active: boolean }>();

function assertValidDate(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("INVALID_DEMO_POLICY_DATE");
}

/** Returns a UTC-midnight Date suitable for Prisma's PostgreSQL DATE fields. */
export function getDemoLocalDay(now: Date, timeZone: string): Date {
  assertValidDate(now);
  if (!timeZone) throw new Error("DEMO_TIME_ZONE_REQUIRED");
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  } catch {
    throw new Error("INVALID_DEMO_TIME_ZONE");
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (!year || !month || !day) throw new Error("INVALID_DEMO_LOCAL_DAY");
  return new Date(Date.UTC(year, month - 1, day));
}

function sortedUnique(ids: string[]) {
  if (ids.some(id => typeof id !== "string" || !id)) throw new Error("DEMO_MATCH_PARTICIPANTS_REQUIRED");
  return [...new Set(ids)].sort();
}

function localDayKey(day: Date) {
  return `${day.getUTCFullYear().toString().padStart(4, "0")}-${(day.getUTCMonth() + 1).toString().padStart(2, "0")}-${day.getUTCDate().toString().padStart(2, "0")}`;
}

async function lockUsers(tx: PolicyTx, userIds: string[]) {
  const ids = sortedUnique(userIds);
  if (ids.length !== userIds.length) throw new Error("DEMO_MATCH_PARTICIPANTS_INVALID");
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User"
    WHERE "id" IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
    ORDER BY "id" ASC
    FOR UPDATE
  `;
  if (rows.length !== ids.length) throw new Error("DEMO_MATCH_PARTICIPANT_NOT_FOUND");
  return ids;
}

async function readSettings(tx: PolicyTx, lock: "SHARE" | "NONE" = "NONE") {
  const rows = lock === "SHARE"
    ? await tx.$queryRaw<SettingsRow[]>`
        SELECT "id", "enabled", "dailyMatchLimit", "timeZone"
        FROM "DemoModeSettings" WHERE "id" = 'global' FOR SHARE
      `
    : await tx.$queryRaw<SettingsRow[]>`
        SELECT "id", "enabled", "dailyMatchLimit", "timeZone"
        FROM "DemoModeSettings" WHERE "id" = 'global'
      `;
  return rows[0] ?? null;
}

async function lockMatch(tx: PolicyTx, matchId: string): Promise<MatchRow> {
  if (!matchId) throw new Error("MATCH_REQUIRED");
  const rows = await tx.$queryRaw<MatchRow[]>`
    SELECT "id", "economyMode", "status", "playerOneId", "playerTwoId"
    FROM "Match" WHERE "id" = ${matchId}::uuid FOR UPDATE
  `;
  const match = rows[0];
  if (!match) throw new Error("MATCH_NOT_FOUND");
  if (match.economyMode !== "DEMO") throw new Error("REAL_MATCH_FORBIDDEN");
  if (!match.playerTwoId || match.playerOneId === match.playerTwoId) throw new Error("DEMO_MATCH_REQUIRES_TWO_PLAYERS");
  return match;
}

function participants(match: MatchRow) {
  return sortedUnique([match.playerOneId, match.playerTwoId!]);
}

async function readReservations(tx: PolicyTx, matchId: string): Promise<ReservationRow[]> {
  return tx.$queryRaw<ReservationRow[]>`
    SELECT "userId", "localDay"::text AS "localDay", "status"::text AS "status"
    FROM "DemoMatchStartReservation" WHERE "matchId" = ${matchId}::uuid
    ORDER BY "userId" ASC
  `;
}

function assertReservationSet(rows: ReservationRow[], userIds: string[]) {
  const actual = rows.map(row => row.userId).sort();
  if (actual.length !== userIds.length || actual.some((id, index) => id !== userIds[index])) {
    throw new Error("DEMO_RESERVATION_SET_INCONSISTENT");
  }
}

async function countQuotaUsage(tx: PolicyTx, userIds: string[], localDay: Date) {
  const rows = await tx.$queryRaw<Array<{ userId: string; count: bigint }>>`
    SELECT usage_rows."userId", count(*)::bigint AS "count"
    FROM (
      SELECT "userId" FROM "DemoMatchUsage"
      WHERE "userId" IN (${Prisma.join(userIds.map(id => Prisma.sql`${id}::uuid`))}) AND "localDay" = ${localDayKey(localDay)}::date
      UNION ALL
      SELECT "userId" FROM "DemoMatchStartReservation"
      WHERE "userId" IN (${Prisma.join(userIds.map(id => Prisma.sql`${id}::uuid`))})
        AND "localDay" = ${localDayKey(localDay)}::date AND "status" = 'RESERVED'::"DemoMatchStartReservationStatus"
    ) AS usage_rows
    GROUP BY usage_rows."userId"
  `;
  return new Map(rows.map(row => [row.userId, Number(row.count)]));
}

function ensureUnderLimit(userIds: string[], counts: Map<string, number>, dailyMatchLimit: number) {
  for (const userId of userIds) {
    if ((counts.get(userId) ?? 0) >= dailyMatchLimit) throw new Error("DEMO_DAILY_LIMIT_REACHED");
  }
}

async function getDemoModeSettingsInTransaction(tx: PolicyTx) {
  const settings = await readSettings(tx, "SHARE");
  return settings
    ? { exists: true, enabled: settings.enabled, dailyMatchLimit: settings.dailyMatchLimit, timeZone: settings.timeZone }
    : { exists: false, enabled: false, dailyMatchLimit: 0, timeZone: KYIV_TIME_ZONE };
}

async function assertDemoUserCanCreateOrJoinInTransaction(tx: PolicyTx, userId: string, action: "CREATE" | "JOIN") {
  if (action !== "CREATE" && action !== "JOIN") throw new Error("INVALID_DEMO_POLICY_ACTION");
  if (!userId) throw new Error("USER_REQUIRED");
  // Global DEMO mode is a server-side kill switch: when it is off (or the
  // settings row is missing) no new DEMO match may be formed. Fail closed.
  const settings = await readSettings(tx, "SHARE");
  if (!settings?.enabled) throw new Error("DEMO_DISABLED");
  // Individual policy remains an admission restriction for CREATE/JOIN.
  await lockUsers(tx, [userId]);
  const blocked = await tx.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId" FROM "DemoUserPolicy" WHERE "userId" = ${userId}::uuid AND "blocked" = true
  `;
  if (blocked.length) throw new Error("DEMO_USER_BLOCKED");
}

async function reserveDemoMatchStartInTransaction(tx: PolicyTx, matchId: string, now: Date) {
  assertValidDate(now);
  const match = await lockMatch(tx, matchId);
  const userIds = participants(match);
  const settings = await readSettings(tx, "SHARE");

  // Do not re-check user block here: CREATE/JOIN policy is intentionally
  // evaluated before a match is formed. A later block must not strand it.
  await lockUsers(tx, userIds);
  const current = await readReservations(tx, matchId);
  if (current.length) {
    assertReservationSet(current, userIds);
    if (current.every(row => row.status === "RESERVED") && (match.status === "READY" || match.status === "STARTING")) {
      return { idempotent: true, localDay: new Date(`${current[0].localDay}T00:00:00.000Z`), userIds };
    }
    if (match.status === "LIVE" && current.every(row => row.status === "CONSUMED")) {
      return { idempotent: true, localDay: new Date(`${current[0].localDay}T00:00:00.000Z`), userIds };
    }
    throw new Error("DEMO_RESERVATION_TERMINAL");
  }
  if (!settings?.enabled) throw new Error("DEMO_DISABLED");
  if (match.status !== "READY" && match.status !== "STARTING") throw new Error("DEMO_MATCH_NOT_RESERVABLE");

  const localDay = getDemoLocalDay(now, settings.timeZone);
  const counts = await countQuotaUsage(tx, userIds, localDay);
  ensureUnderLimit(userIds, counts, settings.dailyMatchLimit);

  // Both rows are inserted in this transaction after both quotas pass. If
  // either insert/constraint fails, PostgreSQL rolls back the complete pair.
  for (const userId of userIds) {
    await tx.$executeRaw`
      INSERT INTO "DemoMatchStartReservation" ("matchId", "userId", "localDay", "status", "reservedAt")
      VALUES (${matchId}::uuid, ${userId}::uuid, ${localDayKey(localDay)}::date, 'RESERVED'::"DemoMatchStartReservationStatus", ${now})
    `;
  }
  return { idempotent: false, localDay, userIds };
}

async function confirmDemoMatchLiveInTransaction(tx: PolicyTx, matchId: string, startedAt: Date) {
  assertValidDate(startedAt);
  const match = await lockMatch(tx, matchId);
  const userIds = participants(match);
  await lockUsers(tx, userIds);
  const current = await readReservations(tx, matchId);

  if (match.status === "LIVE") {
    assertReservationSet(current, userIds);
    if (!current.every(row => row.status === "CONSUMED")) throw new Error("DEMO_LIVE_RESERVATION_INCONSISTENT");
    if (current.some(row => row.localDay !== current[0].localDay)) throw new Error("DEMO_RESERVATION_DAY_INCONSISTENT");
    const usage = await tx.$queryRaw<UsageRow[]>`
      SELECT "userId" FROM "DemoMatchUsage" WHERE "matchId" = ${matchId}::uuid ORDER BY "userId" ASC
    `;
    if (usage.length !== userIds.length || usage.some((row, index) => row.userId !== userIds[index])) {
      throw new Error("DEMO_LIVE_USAGE_INCONSISTENT");
    }
    return { idempotent: true, localDay: new Date(`${current[0].localDay}T00:00:00.000Z`), userIds };
  }

  if (match.status !== "READY" && match.status !== "STARTING") throw new Error("DEMO_MATCH_NOT_STARTABLE");
  assertReservationSet(current, userIds);
  if (!current.every(row => row.status === "RESERVED")) throw new Error("DEMO_RESERVATION_NOT_ACTIVE");
  if (current.some(row => row.localDay !== current[0].localDay)) throw new Error("DEMO_RESERVATION_DAY_INCONSISTENT");
  const reservationDay = current[0].localDay;

  const moved = await tx.$executeRaw`
    UPDATE "DemoMatchStartReservation"
    SET "status" = 'CONSUMED'::"DemoMatchStartReservationStatus", "consumedAt" = ${startedAt},
        "releasedAt" = NULL
    WHERE "matchId" = ${matchId}::uuid AND "userId" IN (${Prisma.join(userIds.map(id => Prisma.sql`${id}::uuid`))})
      AND "status" = 'RESERVED'::"DemoMatchStartReservationStatus"
  `;
  if (moved !== userIds.length) throw new Error("DEMO_RESERVATION_CONFLICT");

  const matchUpdate = await tx.$executeRaw`
    UPDATE "Match" SET "status" = 'LIVE'::"MatchStatus", "startedAt" = ${startedAt}, "updatedAt" = NOW()
    WHERE "id" = ${matchId}::uuid AND "economyMode" = 'DEMO'::"MatchEconomyMode"
      AND "status" IN ('READY'::"MatchStatus", 'STARTING'::"MatchStatus")
  `;
  if (matchUpdate !== 1) throw new Error("DEMO_MATCH_START_CONFLICT");

  for (const userId of userIds) {
    await tx.$executeRaw`
      INSERT INTO "DemoMatchUsage" ("matchId", "userId", "localDay", "startedAt")
      VALUES (${matchId}::uuid, ${userId}::uuid, ${reservationDay}::date, ${startedAt})
    `;
  }
  return { idempotent: false, localDay: new Date(`${reservationDay}T00:00:00.000Z`), userIds };
}

async function releaseDemoMatchReservationInTransaction(tx: PolicyTx, matchId: string, releasedAt: Date) {
  assertValidDate(releasedAt);
  const match = await lockMatch(tx, matchId);
  const userIds = participants(match);
  await lockUsers(tx, userIds);
  const current = await readReservations(tx, matchId);
  if (!current.length) {
    if (match.status === "LIVE" || match.status === "FINISHED" || match.status === "DISPUTED") {
      throw new Error("DEMO_RESERVATION_SET_INCONSISTENT");
    }
    return { idempotent: true, released: 0 };
  }
  assertReservationSet(current, userIds);
  if (current.every(row => row.status === "RELEASED")) return { idempotent: true, released: 0 };
  if (current.some(row => row.status === "CONSUMED") || match.status === "LIVE" || match.status === "FINISHED" || match.status === "DISPUTED") {
    throw new Error("DEMO_CONSUMED_RESERVATION_CANNOT_RELEASE");
  }
  if (!current.every(row => row.status === "RESERVED")) throw new Error("DEMO_RESERVATION_SET_INCONSISTENT");

  const released = await tx.$executeRaw`
    UPDATE "DemoMatchStartReservation"
    SET "status" = 'RELEASED'::"DemoMatchStartReservationStatus", "releasedAt" = ${releasedAt}, "consumedAt" = NULL
    WHERE "matchId" = ${matchId}::uuid AND "userId" IN (${Prisma.join(userIds.map(id => Prisma.sql`${id}::uuid`))})
      AND "status" = 'RESERVED'::"DemoMatchStartReservationStatus"
  `;
  if (released !== userIds.length) throw new Error("DEMO_RESERVATION_CONFLICT");
  return { idempotent: false, released };
}

function createOperations(tx: PolicyTx, isActive: () => boolean): DemoPolicyOperations {
  const assertActive = () => { if (!isActive()) throw new Error("DEMO_POLICY_TRANSACTION_SCOPE_CLOSED"); };
  return {
    getDemoModeSettings: async () => { assertActive(); return getDemoModeSettingsInTransaction(tx); },
    assertDemoUserCanCreateOrJoin: async (...args) => { assertActive(); return assertDemoUserCanCreateOrJoinInTransaction(tx, ...args); },
    reserveDemoMatchStart: async (matchId, now = new Date()) => { assertActive(); return reserveDemoMatchStartInTransaction(tx, matchId, now); },
    confirmDemoMatchLive: async (matchId, startedAt = new Date()) => { assertActive(); return confirmDemoMatchLiveInTransaction(tx, matchId, startedAt); },
    releaseDemoMatchReservation: async (matchId, releasedAt = new Date()) => { assertActive(); return releaseDemoMatchReservationInTransaction(tx, matchId, releasedAt); },
  };
}

/**
 * Composition boundary shared with DEMO wallet operations. It reuses exactly
 * one real Prisma transaction; Match changes, quota rows and future wallet
 * holds can therefore commit or roll back as one unit. Do not retain `policy`
 * methods after this callback returns.
 */
export async function withDemoPolicyTransaction<T>(work: (context: DemoPolicyTransactionContext) => Promise<T>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
  if (policyScope.getStore()) throw new Error("NESTED_DEMO_POLICY_TRANSACTION_NOT_ALLOWED");
  return withDemoTransaction(async context => {
    const scope = { token: Symbol("demo-policy-transaction"), active: true };
    const policy = createOperations(context.db, () => scope.active && policyScope.getStore()?.token === scope.token);
    try {
      return await policyScope.run(scope, () => work({ ...context, policy }));
    } finally {
      scope.active = false;
    }
  }, options);
}

export function getDemoModeSettings() {
  return withDemoPolicyTransaction(({ policy }) => policy.getDemoModeSettings());
}

export function assertDemoUserCanCreateOrJoin(userId: string, action: "CREATE" | "JOIN") {
  return withDemoPolicyTransaction(({ policy }) => policy.assertDemoUserCanCreateOrJoin(userId, action));
}

export function reserveDemoMatchStart(matchId: string, now = new Date()) {
  return withDemoPolicyTransaction(({ policy }) => policy.reserveDemoMatchStart(matchId, now));
}

export function confirmDemoMatchLive(matchId: string, startedAt = new Date()) {
  return withDemoPolicyTransaction(({ policy }) => policy.confirmDemoMatchLive(matchId, startedAt));
}

export function releaseDemoMatchReservation(matchId: string, releasedAt = new Date()) {
  return withDemoPolicyTransaction(({ policy }) => policy.releaseDemoMatchReservation(matchId, releasedAt));
}
