import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { join as joinPath } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { Prisma } from "@prisma/client";

const root = process.cwd();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve(pathToFileURL(joinPath(root, "node_modules", "next", "server.js")).href, context);
    if (specifier === "../auth" && context.parentURL === pathToFileURL(joinPath(root, "app", "api", "server-manager", "events", "route.ts")).href) {
      return nextResolve(pathToFileURL(joinPath(root, "app", "api", "server-manager", "auth.ts")).href, context);
    }
    if (specifier === "@/lib/prisma") return nextResolve(pathToFileURL(`${root}/lib/prisma.ts`).href, context);
    if (specifier === "@/lib/demo-wallet") return nextResolve(pathToFileURL(`${root}/lib/demo-wallet.ts`).href, context);
    if (specifier === "@/lib/current-user") {
      return { url: `data:text/javascript,${encodeURIComponent("export async function getCurrentUser(){return globalThis.__DUELPLAY_TEST_USER__??null}")}`, shortCircuit: true };
    }
    if (specifier === "@/lib/admin-auth") {
      return { url: `data:text/javascript,${encodeURIComponent("export const ADMIN_INVITE_PREFIX='ADMIN_INVITE:'; export async function getCurrentAdminSession(){return globalThis.__DUELPLAY_TEST_ADMIN_SESSION__??null} export function newAdminInviteToken(){throw new Error('ADMIN_AUTH_INVITE_HELPER_NOT_AVAILABLE_IN_TEST')} export function createAdminInviteUrl(){throw new Error('ADMIN_AUTH_INVITE_HELPER_NOT_AVAILABLE_IN_TEST')}")}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/lib/")) return nextResolve(pathToFileURL(joinPath(root, "lib", `${specifier.slice(6)}.ts`)).href, context);
    if (specifier.startsWith("@/app/")) return nextResolve(pathToFileURL(joinPath(root, "app", `${specifier.slice(6)}.ts`)).href, context);
    return nextResolve(specifier, context);
  },
});

const { prisma } = await import("../lib/prisma.ts");
const wallet = await import("../lib/demo-wallet.ts");
const policy = await import("../lib/demo-policy.ts");
const matchesApi = await import("../app/api/matches/route.ts");
const joinApi = await import("../app/api/matches/[id]/join/route.ts");
const cancelApi = await import("../app/api/matches/[id]/cancel/route.ts");
const startApi = await import("../app/api/matches/[id]/start/route.ts");
const serverApi = await import("../app/api/matches/[id]/server/route.ts");
const matchmakingApi = await import("../app/api/matchmaking/route.ts");
const disputesApi = await import("../app/api/disputes/route.ts");
const adminApi = await import("../app/api/admin/route.ts");
const lifecycle = await import("../lib/match-lifecycle.ts");
const serverEventsApi = await import("../app/api/server-manager/events/route.ts");
const adminServerEventsApi = await import("../app/api/admin/server-events/route.ts");
const adminServerIncidentsApi = await import("../app/api/admin/server-incidents/route.ts");
const { createTechnicalEventOutbox } = await import("../scripts/server-manager/technical-event-outbox.mjs");
const prefix = `it_${randomUUID().replaceAll("-", "")}`;
let checks = 0;
let fixtureSequence = 0;
let fixtureGameId;
const triggerNames = [];
const functionNames = [];

async function check(name, run) {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) error.message = `Scenario "${name}" failed: ${error.message}`;
    throw error;
  }
  checks += 1;
  console.log(`PASS PostgreSQL integration: ${name}`);
}

function key(name) {
  return `${prefix}:${name}`;
}

async function count(query) {
  const [row] = await query;
  return Number(row.count);
}

async function createUser() {
  fixtureSequence += 1;
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "User" ("id", "nickname", "referralCode", "updatedAt", "isTestAccount")
    VALUES (${id}::uuid, ${`${prefix}_${fixtureSequence}`}, ${`${prefix}_${fixtureSequence}`}, NOW(), true)
  `;
  return id;
}

async function createMatch(playerOneId, economyMode = "DEMO", playerTwoId = null) {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "Match" ("id", "gameId", "playerOneId", "playerTwoId", "mode", "economyMode", "updatedAt")
    VALUES (${id}::uuid, ${fixtureGameId}::uuid, ${playerOneId}::uuid, ${playerTwoId}::uuid, 'SOLO_1V1'::"MatchMode", ${economyMode}::"MatchEconomyMode", NOW())
  `;
  return id;
}

async function createReadyDemoMatch(playerOneId, playerTwoId) {
  const id = await createMatch(playerOneId, "DEMO", playerTwoId);
  await prisma.match.update({ where: { id }, data: { status: "READY" } });
  return id;
}

async function setDemoSettings({ enabled = true, dailyMatchLimit = 3, timeZone = "Europe/Kyiv" } = {}) {
  await prisma.demoModeSettings.update({
    where: { id: "global" },
    data: { enabled, dailyMatchLimit, timeZone },
  });
}

async function setDemoUserBlocked(userId, changedById, blocked, reason = null) {
  await prisma.demoUserPolicy.upsert({
    where: { userId },
    create: { userId, changedById, blocked, reason },
    update: { changedById, blocked, reason },
  });
}

async function makeTrigger(table, triggerName, functionName, keyValue) {
  assert.match(triggerName, /^it_[a-z0-9_]+$/);
  assert.match(functionName, /^it_[a-z0-9_]+$/);
  assert.match(keyValue, /^[a-z0-9_:]+$/);
  triggerNames.push({ table, triggerName });
  functionNames.push(functionName);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."idempotencyKey" = '${keyValue}' THEN
        RAISE EXCEPTION 'integration fault injection';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
}

async function makeWalletUniqueFailureTrigger() {
  const triggerName = `${prefix}_wallet_other_unique`;
  const functionName = `${prefix}_wallet_other_unique_fn`;
  assert.match(triggerName, /^it_[a-z0-9_]+$/);
  assert.match(functionName, /^it_[a-z0-9_]+$/);
  triggerNames.push({ table: "DemoWallet", triggerName });
  functionNames.push(functionName);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'integration unrelated wallet unique constraint'
        USING ERRCODE = '23505', CONSTRAINT = 'injected_demo_wallet_other_unique';
      RETURN NEW;
    END;
    $$
  `);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "DemoWallet" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
}

async function makeReservationFailureTrigger(failUserId) {
  const triggerName = `${prefix}_reservation_fault`;
  const functionName = `${prefix}_reservation_fault_fn`;
  assert.match(triggerName, /^it_[a-z0-9_]+$/);
  assert.match(functionName, /^it_[a-z0-9_]+$/);
  assert.match(failUserId, /^[0-9a-f-]{36}$/i);
  triggerNames.push({ table: "DemoMatchStartReservation", triggerName });
  functionNames.push(functionName);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."userId" = '${failUserId}'::uuid THEN
        RAISE EXCEPTION 'injected second participant reservation failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "DemoMatchStartReservation" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
}

async function dropFaultTriggers() {
  for (const { table, triggerName } of triggerNames) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${table}"`).catch(() => {});
  }
  for (const functionName of functionNames) {
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`).catch(() => {});
  }
}

async function rejected(promise, pattern) {
  await assert.rejects(promise, pattern);
}

async function realFinancialSnapshot() {
  const [wallets] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "Wallet"`;
  const [transactions] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "Transaction"`;
  const [deposits] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "Deposit"`;
  const [withdrawals] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "Withdrawal"`;
  return [wallets.count, transactions.count, deposits.count, withdrawals.count].map(Number);
}

async function testRealConcurrentConnections() {
  const count = 4;
  let entered = 0;
  let release;
  let timeoutId;
  const gate = new Promise(resolve => { release = resolve; });
  let allEntered;
  const ready = new Promise(resolve => { allEntered = resolve; });
  const work = Array.from({ length: count }, () => prisma.$transaction(async tx => {
    const [row] = await tx.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
    entered += 1;
    if (entered === count) allEntered();
    await gate;
    return row.pid;
  }));
  const timeout = new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("Timed out establishing concurrent PostgreSQL transactions")), 15_000); });
  try {
    await Promise.race([ready, timeout]);
  } finally {
    clearTimeout(timeoutId);
    release();
  }
  const pids = await Promise.all(work);
  assert.ok(new Set(pids).size > 1, "Expected multiple real PostgreSQL backend processes");
}

async function runDemoPolicyIntegrationTests(changedById) {
  const now = new Date("2026-10-12T12:00:00.000Z");
  await setDemoSettings({ enabled: true, dailyMatchLimit: 3 });

  await check("policy settings fail closed when absent and report the configured singleton", async () => {
    const settings = await policy.getDemoModeSettings();
    assert.deepEqual(settings, { exists: true, enabled: true, dailyMatchLimit: 3, timeZone: "Europe/Kyiv" });
    await prisma.demoModeSettings.delete({ where: { id: "global" } });
    assert.deepEqual(await policy.getDemoModeSettings(), { exists: false, enabled: false, dailyMatchLimit: 0, timeZone: "Europe/Kyiv" });
    const one = await createUser();
    const two = await createUser();
    const matchId = await createReadyDemoMatch(one, two);
    await rejected(policy.reserveDemoMatchStart(matchId, now), /DEMO_DISABLED/);
    await prisma.demoModeSettings.create({ data: { id: "global", enabled: true, dailyMatchLimit: 3, timeZone: "Europe/Kyiv" } });
  });

  await check("A: concurrent starts never reserve more than the daily quota", async () => {
    const userId = await createUser();
    const opponents = await Promise.all(Array.from({ length: 9 }, () => createUser()));
    const matches = await Promise.all(opponents.map(opponentId => createReadyDemoMatch(userId, opponentId)));
    const outcomes = await Promise.allSettled(matches.map(matchId => policy.reserveDemoMatchStart(matchId, now)));
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 3);
    for (const result of outcomes.filter(item => item.status === "rejected")) {
      assert.match(String(result.reason), /DEMO_DAILY_LIMIT_REACHED/);
    }
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "userId" = ${userId}::uuid AND "localDay" = DATE '2026-10-12' AND "status" = 'RESERVED'`), 3);
  });

  await check("B: a two-player start reserves both participants or neither", async () => {
    const one = await createUser();
    const two = await createUser();
    const matchId = await createReadyDemoMatch(one, two);
    const result = await policy.reserveDemoMatchStart(matchId, now);
    assert.equal(result.userIds.length, 2);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${matchId}::uuid AND "status" = 'RESERVED'`), 2);
  });

  await check("C: overlapping concurrent starts serialize by sorted user locks without partial rows or deadlock", async () => {
    const users = await Promise.all(Array.from({ length: 4 }, () => createUser()));
    const pairs = [
      [users[0], users[1]], [users[1], users[2]], [users[2], users[3]], [users[3], users[0]],
      [users[0], users[2]], [users[1], users[3]], [users[0], users[3]], [users[1], users[2]],
    ];
    const matches = await Promise.all(pairs.map(([one, two]) => createReadyDemoMatch(one, two)));
    const run = Promise.allSettled(matches.map(matchId => policy.reserveDemoMatchStart(matchId, now)));
    let timer;
    const outcomes = await Promise.race([
      run,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("DEMO policy concurrency timed out (possible lock cycle)")), 20_000); }),
    ]).finally(() => clearTimeout(timer));
    for (const result of outcomes.filter(item => item.status === "rejected")) {
      assert.match(String(result.reason), /DEMO_DAILY_LIMIT_REACHED/);
    }
    const partial = await count(prisma.$queryRaw`
      SELECT count(*)::int AS count FROM (
        SELECT "matchId" FROM "DemoMatchStartReservation" WHERE "matchId" IN (${Prisma.join(matches.map(id => Prisma.sql`${id}::uuid`))})
        GROUP BY "matchId" HAVING count(*) NOT IN (0, 2)
      ) AS partial_rows
    `);
    assert.equal(partial, 0);
    const perUser = await prisma.$queryRaw`
      SELECT "userId", count(*)::int AS count FROM "DemoMatchStartReservation"
      WHERE "userId" IN (${Prisma.join(users.map(id => Prisma.sql`${id}::uuid`))})
        AND "localDay" = DATE '2026-10-12' AND "status" = 'RESERVED'
      GROUP BY "userId"
    `;
    assert.ok(perUser.every(row => Number(row.count) <= 3));
  });

  await check("D: repeated concurrent LIVE callbacks consume each reservation and write usage once", async () => {
    const one = await createUser();
    const two = await createUser();
    const matchId = await createReadyDemoMatch(one, two);
    await policy.reserveDemoMatchStart(matchId, now);
    const startedAt = new Date("2026-10-12T13:00:00.000Z");
    const results = await Promise.all(Array.from({ length: 16 }, () => policy.confirmDemoMatchLive(matchId, startedAt)));
    assert.equal(results.filter(result => result.idempotent).length, 15);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${matchId}::uuid AND "status" = 'CONSUMED'`), 2);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "matchId" = ${matchId}::uuid`), 2);
  });

  await check("policy facade composes Match, quota and wallet changes in one transaction", async () => {
    const one = await createUser();
    const two = await createUser();
    const matchId = await createReadyDemoMatch(one, two);
    await policy.reserveDemoMatchStart(matchId, now);
    await wallet.grantDemoStarterCredits(one);
    await wallet.reserveDemoStake(one, matchId, "100", key("policy_compose_debit"), key("policy_compose_hold"));
    await assert.rejects(policy.withDemoPolicyTransaction(async ({ policy: scopedPolicy, demo }) => {
      await scopedPolicy.confirmDemoMatchLive(matchId, new Date("2026-10-12T13:30:00.000Z"));
      await demo.closeDemoWalletHold(one, matchId, "100", key("policy_compose_refund"), "RELEASED");
      throw new Error("INJECTED_POLICY_COMPOSITION_ROLLBACK");
    }), /INJECTED_POLICY_COMPOSITION_ROLLBACK/);
    const [match] = await prisma.$queryRaw`SELECT "status"::text AS status FROM "Match" WHERE "id" = ${matchId}::uuid`;
    assert.equal(match.status, "READY");
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${matchId}::uuid AND "status" = 'RESERVED'`), 2);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "matchId" = ${matchId}::uuid`), 0);
    const [walletRow] = await prisma.$queryRaw`SELECT "balance"::text AS balance, "lockedBalance"::text AS locked FROM "DemoWallet" WHERE "userId" = ${one}::uuid`;
    assert.equal(walletRow.balance, "9900.0000");
    assert.equal(walletRow.locked, "100.0000");
    const [hold] = await prisma.$queryRaw`SELECT "status"::text AS status FROM "DemoWalletHold" WHERE "idempotencyKey" = ${key("policy_compose_hold")}`;
    assert.equal(hold.status, "ACTIVE");
  });

  await check("E: concurrent pre-LIVE release and LIVE confirmation produce one valid terminal outcome", async () => {
    const one = await createUser();
    const two = await createUser();
    const matchId = await createReadyDemoMatch(one, two);
    await policy.reserveDemoMatchStart(matchId, now);
    const results = await Promise.allSettled([
      policy.confirmDemoMatchLive(matchId, new Date("2026-10-12T14:00:00.000Z")),
      policy.releaseDemoMatchReservation(matchId, new Date("2026-10-12T14:00:01.000Z")),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const [match] = await prisma.$queryRaw`SELECT "status"::text AS status FROM "Match" WHERE "id" = ${matchId}::uuid`;
    const [reservations] = await prisma.$queryRaw`
      SELECT count(*)::int AS count, min("status"::text) AS status, max("status"::text) AS max_status
      FROM "DemoMatchStartReservation" WHERE "matchId" = ${matchId}::uuid
    `;
    const usageCount = await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "matchId" = ${matchId}::uuid`);
    assert.equal(Number(reservations.count), 2);
    if (match.status === "LIVE") {
      assert.equal(reservations.status, "CONSUMED");
      assert.equal(reservations.max_status, "CONSUMED");
      assert.equal(usageCount, 2);
      await rejected(policy.releaseDemoMatchReservation(matchId), /DEMO_CONSUMED_RESERVATION_CANNOT_RELEASE/);
    } else {
      assert.equal(reservations.status, "RELEASED");
      assert.equal(reservations.max_status, "RELEASED");
      assert.equal(usageCount, 0);
      const duplicate = await policy.releaseDemoMatchReservation(matchId);
      assert.equal(duplicate.idempotent, true);
    }
  });

  await check("F: block applies to CREATE/JOIN but a formed match remains startable", async () => {
    const blockedUser = await createUser();
    const opponent = await createUser();
    const alreadyFormed = await createReadyDemoMatch(blockedUser, opponent);
    await setDemoUserBlocked(blockedUser, changedById, true, "Integration policy block");
    await rejected(policy.assertDemoUserCanCreateOrJoin(blockedUser, "CREATE"), /DEMO_USER_BLOCKED/);
    await rejected(policy.assertDemoUserCanCreateOrJoin(blockedUser, "JOIN"), /DEMO_USER_BLOCKED/);
    const reservation = await policy.reserveDemoMatchStart(alreadyFormed, now);
    assert.deepEqual(reservation.userIds, [blockedUser, opponent].sort());
    await policy.confirmDemoMatchLive(alreadyFormed, new Date("2026-10-12T15:00:00.000Z"));
    const [match] = await prisma.$queryRaw`SELECT "status"::text AS status FROM "Match" WHERE "id" = ${alreadyFormed}::uuid`;
    assert.equal(match.status, "LIVE");
  });

  await check("G: disabling DEMO blocks new reservations but preserves formed and LIVE DEMO modes", async () => {
    const one = await createUser();
    const two = await createUser();
    const priorLiveOpponent = await createUser();
    const alreadyLive = await createReadyDemoMatch(one, priorLiveOpponent);
    await policy.reserveDemoMatchStart(alreadyLive, now);
    await policy.confirmDemoMatchLive(alreadyLive, new Date("2026-10-12T15:30:00.000Z"));
    const formed = await createReadyDemoMatch(one, two);
    await policy.reserveDemoMatchStart(formed, now);
    await setDemoSettings({ enabled: false, dailyMatchLimit: 3 });

    const anotherOne = await createUser();
    const anotherTwo = await createUser();
    const newMatch = await createReadyDemoMatch(anotherOne, anotherTwo);
    await rejected(policy.reserveDemoMatchStart(newMatch, now), /DEMO_DISABLED/);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${newMatch}::uuid`), 0);

    await policy.confirmDemoMatchLive(formed, new Date("2026-10-12T16:00:00.000Z"));
    const [formedRow] = await prisma.$queryRaw`SELECT "status"::text AS status, "economyMode"::text AS "economyMode" FROM "Match" WHERE "id" = ${formed}::uuid`;
    assert.deepEqual(formedRow, { status: "LIVE", economyMode: "DEMO" });
    await setDemoSettings({ enabled: true, dailyMatchLimit: 3 });
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "Match" WHERE "id" IN (${alreadyLive}::uuid, ${formed}::uuid) AND "status" = 'LIVE'::"MatchStatus" AND "economyMode" = 'DEMO'::"MatchEconomyMode"`), 2);
  });

  await check("H: Europe/Kyiv day calculation handles local midnight and both DST transitions", async () => {
    const day = value => policy.getDemoLocalDay(new Date(value), "Europe/Kyiv").toISOString().slice(0, 10);
    assert.equal(day("2026-10-12T20:59:00.000Z"), "2026-10-12");
    assert.equal(day("2026-10-12T21:00:00.000Z"), "2026-10-13");
    assert.equal(day("2026-10-12T22:30:00.000Z"), "2026-10-13");
    assert.equal(day("2026-03-29T00:59:00.000Z"), "2026-03-29");
    assert.equal(day("2026-03-29T01:00:00.000Z"), "2026-03-29");
    assert.equal(day("2026-10-25T00:59:00.000Z"), "2026-10-25");
    assert.equal(day("2026-10-25T01:00:00.000Z"), "2026-10-25");
    assert.equal(policy.getDemoLocalDay(new Date("2026-10-12T22:30:00.000Z"), "UTC").toISOString().slice(0, 10), "2026-10-12");

    const one = await createUser();
    const two = await createUser();
    const matchId = await createReadyDemoMatch(one, two);
    await policy.reserveDemoMatchStart(matchId, new Date("2026-10-12T20:59:00.000Z"));
    await policy.confirmDemoMatchLive(matchId, new Date("2026-10-12T21:00:00.000Z"));
    const [reservation] = await prisma.$queryRaw`
      SELECT "localDay"::text AS "localDay", "status"::text AS status
      FROM "DemoMatchStartReservation" WHERE "matchId" = ${matchId}::uuid AND "userId" = ${one}::uuid
    `;
    const [usage] = await prisma.$queryRaw`
      SELECT "localDay"::text AS "localDay" FROM "DemoMatchUsage"
      WHERE "matchId" = ${matchId}::uuid AND "userId" = ${one}::uuid
    `;
    assert.deepEqual(reservation, { localDay: "2026-10-12", status: "CONSUMED" });
    assert.equal(usage.localDay, "2026-10-12", "LIVE after Kyiv midnight remains charged to its reservation day");
  });

  await check("existing reservation can enter LIVE after Kyiv midnight when DEMO is disabled and limit is zero", async () => {
    const one = await createUser();
    const two = await createUser();
    const matchId = await createReadyDemoMatch(one, two);
    await policy.reserveDemoMatchStart(matchId, new Date("2026-10-12T20:59:00.000Z"));
    await setDemoSettings({ enabled: false, dailyMatchLimit: 0, timeZone: "Europe/Kyiv" });
    const startedAt = new Date("2026-10-12T21:00:00.000Z");
    const result = await policy.confirmDemoMatchLive(matchId, startedAt);
    assert.equal(result.idempotent, false);
    const [row] = await prisma.$queryRaw`
      SELECT m."status"::text AS status, m."economyMode"::text AS "economyMode",
             r."localDay"::text AS "reservationDay", u."localDay"::text AS "usageDay"
      FROM "Match" m
      JOIN "DemoMatchStartReservation" r ON r."matchId" = m."id" AND r."userId" = ${one}::uuid
      JOIN "DemoMatchUsage" u ON u."matchId" = m."id" AND u."userId" = ${one}::uuid
      WHERE m."id" = ${matchId}::uuid
    `;
    assert.deepEqual(row, { status: "LIVE", economyMode: "DEMO", reservationDay: "2026-10-12", usageDay: "2026-10-12" });
    assert.equal(result.localDay.toISOString().slice(0, 10), "2026-10-12");
    const duplicate = await policy.confirmDemoMatchLive(matchId, new Date("2026-10-12T21:00:01.000Z"));
    assert.equal(duplicate.idempotent, true);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "matchId" = ${matchId}::uuid`), 2);
    await setDemoSettings({ enabled: true, dailyMatchLimit: 3 });
  });

  await check("I: a failure on the second participant insert rolls back the first reservation", async () => {
    const userIds = [await createUser(), await createUser()].sort();
    const matchId = await createReadyDemoMatch(userIds[0], userIds[1]);
    await makeReservationFailureTrigger(userIds[1]);
    await rejected(policy.reserveDemoMatchStart(matchId, now), /injected second participant reservation failure/);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${matchId}::uuid`), 0);
    await dropFaultTriggers();
    triggerNames.length = 0;
    functionNames.length = 0;
  });

  await check("J: releases return quota before LIVE; consumed matches count once and cannot release", async () => {
    const one = await createUser();
    const releasedOpponents = await Promise.all(Array.from({ length: 4 }, () => createUser()));
    for (const opponent of releasedOpponents) {
      const matchId = await createReadyDemoMatch(one, opponent);
      await policy.reserveDemoMatchStart(matchId, now);
      const first = await policy.releaseDemoMatchReservation(matchId, now);
      const retry = await policy.releaseDemoMatchReservation(matchId, now);
      assert.equal(first.released, 2);
      assert.equal(retry.idempotent, true);
    }
    const liveOpponents = await Promise.all(Array.from({ length: 4 }, () => createUser()));
    const liveMatches = await Promise.all(liveOpponents.map(opponent => createReadyDemoMatch(one, opponent)));
    for (const matchId of liveMatches.slice(0, 3)) {
      await policy.reserveDemoMatchStart(matchId, now);
      await policy.confirmDemoMatchLive(matchId, new Date("2026-10-12T17:00:00.000Z"));
    }
    await rejected(policy.reserveDemoMatchStart(liveMatches[3], now), /DEMO_DAILY_LIMIT_REACHED/);
    await rejected(policy.releaseDemoMatchReservation(liveMatches[0], now), /DEMO_CONSUMED_RESERVATION_CANNOT_RELEASE/);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "userId" = ${one}::uuid AND "localDay" = DATE '2026-10-12'`), 3);

    const afterReleaseUser = await createUser();
    const opponentOne = await createUser();
    const firstMatch = await createReadyDemoMatch(afterReleaseUser, opponentOne);
    await policy.reserveDemoMatchStart(firstMatch, now);
    await policy.releaseDemoMatchReservation(firstMatch, now);
    const opponentTwo = await createUser();
    const nextMatch = await createReadyDemoMatch(afterReleaseUser, opponentTwo);
    await policy.reserveDemoMatchStart(nextMatch, now);
    await policy.confirmDemoMatchLive(nextMatch, new Date("2026-10-12T18:00:00.000Z"));
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "userId" = ${afterReleaseUser}::uuid AND "localDay" = DATE '2026-10-12'`), 1);
  });

  await setDemoSettings({ enabled: true, dailyMatchLimit: 3, timeZone: "Europe/Kyiv" });
}

async function createSettledDemoDispute({ stake = "10", fee = "1" } = {}) {
  const one = await createUser();
  const two = await createUser();
  await wallet.grantDemoStarterCredits(one);
  await wallet.grantDemoStarterCredits(two);
  const matchId = await createMatch(one, "DEMO", two);
  await prisma.match.update({ where: { id: matchId }, data: { status: "LIVE", betAmount: new Prisma.Decimal(stake), commission: new Prisma.Decimal(fee), startedAt: new Date() } });
  await wallet.reserveDemoStake(one, matchId, stake, key(`dispute_stake:${matchId}:${one}`), key(`dispute_hold:${matchId}:${one}`));
  await wallet.reserveDemoStake(two, matchId, stake, key(`dispute_stake:${matchId}:${two}`), key(`dispute_hold:${matchId}:${two}`));
  await wallet.closeDemoWalletHold(one, matchId, stake, key(`dispute_close:${matchId}:${one}`), "CONSUMED");
  await wallet.closeDemoWalletHold(two, matchId, stake, key(`dispute_close:${matchId}:${two}`), "CONSUMED");
  const oldPayout = new Prisma.Decimal(stake).mul(2).minus(fee).toDecimalPlaces(4);
  await wallet.creditDemoCredits(one, oldPayout, `demo:result-win:${matchId}`, "MATCH_WIN", matchId, "Initial settled result");
  if (new Prisma.Decimal(fee).gt(0)) await wallet.recordDemoMatchFee(matchId, fee, `demo:match-fee:${matchId}`);
  await prisma.match.update({ where: { id: matchId }, data: { status: "DISPUTED", winnerId: one, loserId: two } });
  const dispute = await prisma.dispute.create({ data: { matchId, reporterId: two, reason: "Integration dispute", status: "OPEN" } });
  return { one, two, matchId, disputeId: dispute.id, oldPayout };
}

async function resolveDemoDisputeTransaction({ matchId, disputeId, decision, failAfterSettlement = false }) {
  return policy.withDemoPolicyTransaction(async ({ db, demo }) => {
    const [dispute] = await db.$queryRaw`SELECT id, "matchId", status, "adminDecision" FROM "Dispute" WHERE id = ${disputeId}::uuid FOR UPDATE`;
    if (!dispute) throw new Error("NOT_FOUND");
    if (["RESOLVED_BY_ADMIN", "CLOSED"].includes(dispute.status)) {
      if (dispute.adminDecision !== decision) throw new Error("DISPUTE_DECISION_CONFLICT");
      return { idempotent: true };
    }
    const [match] = await db.$queryRaw`SELECT * FROM "Match" WHERE id = ${matchId}::uuid FOR UPDATE`;
    if (!match || match.status !== "DISPUTED") throw new Error("MATCH_STATE");
    const winnerId = decision === "WINNER_PLAYER_ONE" ? match.playerOneId
      : decision === "WINNER_PLAYER_TWO" ? match.playerTwoId : null;
    await demo.resolveDemoDispute(matchId, disputeId, decision, winnerId,
      new Prisma.Decimal(match.betAmount.toString()), new Prisma.Decimal(match.commission.toString()));
    if (failAfterSettlement) throw new Error("INJECTED_DISPUTE_ROLLBACK");
    await db.match.update({ where: { id: matchId }, data: { status: winnerId ? "FINISHED" : "CANCELLED", winnerId, loserId: winnerId ? (winnerId === match.playerOneId ? match.playerTwoId : match.playerOneId) : null, endedAt: new Date() } });
    await db.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED_BY_ADMIN", adminDecision: decision, resolvedAt: new Date() } });
    return { idempotent: false, winnerId };
  });
}

async function runDemoDisputeIntegrationTests() {
  const adminId = await createUser();
  await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
  globalThis.__DUELPLAY_TEST_ADMIN_SESSION__ = {
    user: { id: adminId, twoFactorEnabled: true },
    adminMfaVerifiedAt: new Date(),
  };

  await check("ordinary and administrative dispute APIs serialize repeat/conflicting decisions with common DEMO accounting", async () => {
    const endpoints = [
      {
        name: "ordinary dispute resolver",
        resolve: (setup, decision) => patchJson(disputesApi.PATCH, "http://duelplay.test/api/disputes", { id: setup.disputeId, decision }),
      },
      {
        name: "admin dispatcher dispute resolver",
        resolve: (setup, decision) => patchJson(adminApi.PATCH, "http://duelplay.test/api/admin", { action: "resolveDispute", disputeId: setup.disputeId, decision }),
      },
    ];
    for (const endpoint of endpoints) {
      const same = await createSettledDemoDispute();
      const repeated = await Promise.all([
        endpoint.resolve(same, "WINNER_PLAYER_TWO"),
        endpoint.resolve(same, "WINNER_PLAYER_TWO"),
      ]);
      for (const response of repeated) await assertApiStatus(response, 200, { scenario: `${endpoint.name} concurrent duplicate`, endpoint: endpoint.name });
      const repeatedConflict = await endpoint.resolve(same, "DRAW");
      await assertApiStatus(repeatedConflict, 409, { scenario: `${endpoint.name} conflicting repeat`, endpoint: endpoint.name });
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "idempotencyKey" LIKE ${`demo:dispute:${same.disputeId}:%`}`), 2);

      const conflict = await createSettledDemoDispute();
      const competing = await Promise.all([
        endpoint.resolve(conflict, "WINNER_PLAYER_TWO"),
        endpoint.resolve(conflict, "DRAW"),
      ]);
      assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "Dispute" WHERE "id" = ${conflict.disputeId}::uuid AND "status" = 'RESOLVED_BY_ADMIN'`), 1);
    }
  });

  await check("DEMO draw/refund dispute compensates both wallets and reverses the virtual fee without reopening holds", async () => {
    const setup = await createSettledDemoDispute();
    await resolveDemoDisputeTransaction({ matchId: setup.matchId, disputeId: setup.disputeId, decision: "DRAW" });
    const wallets = await prisma.demoWallet.findMany({ where: { userId: { in: [setup.one, setup.two] } }, orderBy: { userId: "asc" } });
    assert.deepEqual(wallets.map(row => row.balance.toFixed(4)), ["10000.0000", "10000.0000"]);
    assert.deepEqual(wallets.map(row => row.debtBalance.toFixed(4)), ["0.0000", "0.0000"]);
    assert.equal(Number((await prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${setup.matchId}::uuid AND "type" = 'MATCH_FEE_ADJUSTMENT' AND "amount" = -1`)[0].count), 1);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${setup.matchId}::uuid AND "status" = 'CONSUMED'`), 2);
  });

  await check("DEMO dispute reversals preserve append-only ledger and create repayable debt after the old win was spent", async () => {
    for (const spendAmount of ["10009", "10000"]) {
      const setup = await createSettledDemoDispute();
      await wallet.adjustDemoCredits(setup.one, new Prisma.Decimal(spendAmount).negated(), key(`spent_old_win:${setup.matchId}`), "Integration spend of prior virtual winnings");
      const before = await prisma.demoWallet.findUnique({ where: { userId: setup.one } });
      const [holdsBefore] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${setup.matchId}::uuid AND "status" = 'CONSUMED'`;
      assert.equal(Number(holdsBefore.count), 2);
      await resolveDemoDisputeTransaction({ matchId: setup.matchId, disputeId: setup.disputeId, decision: "WINNER_PLAYER_TWO" });
      const after = await prisma.demoWallet.findUnique({ where: { userId: setup.one } });
      const expectedAvailable = spendAmount === "10009" ? "0.0000" : "0.0000";
      const expectedDebt = spendAmount === "10009" ? "19.0000" : "10.0000";
      assert.equal(after.balance.toFixed(4), expectedAvailable);
      assert.equal(after.debtBalance.toFixed(4), expectedDebt);
      assert.ok(after.balance.gte(0), "Dispute recovery must never make spendable balance negative");
      assert.ok(before.balance.gte(0));
      assert.equal(Number((await prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${setup.matchId}::uuid AND "type" = 'DISPUTE_ADJUSTMENT'`)[0].count), spendAmount === "10009" ? 0 : 1);
      assert.equal(Number((await prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${setup.matchId}::uuid AND "type" = 'DEBT_ADJUSTMENT' AND "amount" > 0`)[0].count), 1);
      assert.equal(Number((await prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${setup.matchId}::uuid AND "status" = 'CONSUMED'`)[0].count), 2, "Closed holds must remain immutable");
      await wallet.creditDemoCredits(setup.one, "4", key(`future_credit:${setup.matchId}`), "MATCH_WIN", setup.matchId, "Future credit repays virtual debt first");
      const repaid = await prisma.demoWallet.findUnique({ where: { userId: setup.one } });
      if (spendAmount === "10009") {
        assert.equal(repaid.debtBalance.toFixed(4), "15.0000");
        assert.equal(repaid.balance.toFixed(4), "0.0000");
      } else {
        assert.equal(repaid.debtBalance.toFixed(4), "6.0000");
        assert.equal(repaid.balance.toFixed(4), "0.0000");
      }
    }
  });

  await check("DEMO dispute transaction rollback reverts compensation, debt, Match and Dispute together", async () => {
    const setup = await createSettledDemoDispute();
    await wallet.adjustDemoCredits(setup.one, "-10009", key(`rollback_spend:${setup.matchId}`), "Spend old result before injected dispute rollback");
    const beforeWallets = await prisma.demoWallet.findMany({ where: { userId: { in: [setup.one, setup.two] } }, orderBy: { userId: "asc" } });
    const beforeLedger = await prisma.$queryRaw`SELECT "idempotencyKey" FROM "DemoTransaction" WHERE "matchId" = ${setup.matchId}::uuid ORDER BY "idempotencyKey"`;
    const beforeMatch = await prisma.match.findUniqueOrThrow({ where: { id: setup.matchId }, select: { status: true, winnerId: true, loserId: true, endedAt: true, connectionPhaseCompleted: true } });
    const beforeDispute = await prisma.dispute.findUniqueOrThrow({ where: { id: setup.disputeId }, select: { status: true, adminDecision: true } });
    assert.deepEqual(beforeDispute, { status: "OPEN", adminDecision: "PENDING" });
    await rejected(resolveDemoDisputeTransaction({ matchId: setup.matchId, disputeId: setup.disputeId, decision: "WINNER_PLAYER_TWO", failAfterSettlement: true }), /INJECTED_DISPUTE_ROLLBACK/);
    assert.deepEqual(await prisma.demoWallet.findMany({ where: { userId: { in: [setup.one, setup.two] } }, orderBy: { userId: "asc" } }), beforeWallets);
    assert.deepEqual(await prisma.$queryRaw`SELECT "idempotencyKey" FROM "DemoTransaction" WHERE "matchId" = ${setup.matchId}::uuid ORDER BY "idempotencyKey"`, beforeLedger);
    assert.deepEqual(await prisma.match.findUniqueOrThrow({ where: { id: setup.matchId }, select: { status: true, winnerId: true, loserId: true, endedAt: true, connectionPhaseCompleted: true } }), beforeMatch);
    assert.deepEqual(await prisma.dispute.findUniqueOrThrow({ where: { id: setup.disputeId }, select: { status: true, adminDecision: true } }), beforeDispute);
  });

  await check("same and conflicting concurrent DEMO dispute resolutions serialize and remain idempotent", async () => {
    const same = await createSettledDemoDispute();
    const sameResults = await Promise.all([
      resolveDemoDisputeTransaction({ matchId: same.matchId, disputeId: same.disputeId, decision: "WINNER_PLAYER_TWO" }),
      resolveDemoDisputeTransaction({ matchId: same.matchId, disputeId: same.disputeId, decision: "WINNER_PLAYER_TWO" }),
    ]);
    assert.equal(sameResults.filter(result => result.idempotent).length, 1);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "idempotencyKey" LIKE ${`demo:dispute:${same.disputeId}:%`}`), 2);

    const conflict = await createSettledDemoDispute();
    const outcomes = await Promise.allSettled([
      resolveDemoDisputeTransaction({ matchId: conflict.matchId, disputeId: conflict.disputeId, decision: "WINNER_PLAYER_TWO" }),
      resolveDemoDisputeTransaction({ matchId: conflict.matchId, disputeId: conflict.disputeId, decision: "DRAW" }),
    ]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    const rejectedResult = outcomes.find(result => result.status === "rejected");
    assert.match(String(rejectedResult?.reason), /DISPUTE_DECISION_CONFLICT/);
    const [resolved] = await prisma.$queryRaw`SELECT "adminDecision" FROM "Dispute" WHERE "id" = ${conflict.disputeId}::uuid`;
    const correctionCount = await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "idempotencyKey" LIKE ${`demo:dispute:${conflict.disputeId}:%`}`);
    assert.equal(correctionCount, resolved.adminDecision === "DRAW" || resolved.adminDecision === "CANCELLED_REFUND" ? 4 : 2);
  });
}

function setApiUser(userId) {
  globalThis.__DUELPLAY_TEST_USER__ = { id: userId, nickname: userId, role: "USER", twoFactorEnabled: false };
}

async function postJson(handler, url, body, headers = {}, params) {
  const request = new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return handler(request, params ? { params: Promise.resolve(params) } : undefined);
}

async function patchJson(handler, url, body) {
  const request = new Request(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return handler(request);
}

async function assertApiStatus(response, expected, { scenario, endpoint, method = "POST" }) {
  let body = "<unavailable>";
  try {
    body = (await response.clone().text())
      .replace(/("(?:access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie)"\s*:\s*)"[^"]*"/gi, "$1\"[REDACTED]\"")
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 400);
  } catch { /* Keep the status assertion useful even when the response body is unreadable. */ }
  assert.equal(response.status, expected,
    `${scenario}: ${method} ${endpoint} expected HTTP ${expected}, got ${response.status}; response=${body}`);
}

async function demoUserSideEffects(userId) {
  const walletRow = await prisma.demoWallet.findUnique({ where: { userId }, select: { id: true, balance: true, lockedBalance: true } });
  return {
    wallet: walletRow && { id: walletRow.id, balance: walletRow.balance.toString(), lockedBalance: walletRow.lockedBalance.toString() },
    transactions: await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "userId" = ${userId}::uuid`),
    holds: await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "walletId" IN (SELECT "id" FROM "DemoWallet" WHERE "userId" = ${userId}::uuid)`),
    reservations: await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "userId" = ${userId}::uuid`),
    usage: await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "userId" = ${userId}::uuid`),
    readyNotifications: await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "Notification" WHERE "userId" = ${userId}::uuid AND "type" = 'MATCH_READY'::"NotificationType"`),
  };
}

async function createDemoMatchThroughApi(userId, requestKey) {
  setApiUser(userId);
  const response = await postJson(matchesApi.POST, "http://duelplay.test/api/matches", {
    economyMode: "DEMO", betAmount: "3", mode: "SOLO_1V1", format: "1v1", mapName: "aim_redline", idempotencyKey: requestKey,
  }, { "idempotency-key": requestKey });
  const payload = await response.json();
  if (!response.ok) throw new Error(`DEMO match create failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function joinDemoMatchThroughApi(userId, matchId, requestKey) {
  setApiUser(userId);
  return postJson(joinApi.POST, `http://duelplay.test/api/matches/${matchId}/join`, { idempotencyKey: requestKey }, { "idempotency-key": requestKey }, { id: matchId });
}

async function runDemoMatchApplicationIntegrationTests() {
  process.env.NODE_ENV = "test";
  process.env.DUELPLAY_LOCAL_TEST_MODE = "true";
  await setDemoSettings({ enabled: true, dailyMatchLimit: 3 });

  await check("DEMO matchmaking only claims a DEMO candidate and reserves the joiner's virtual stake", async () => {
    const creator = await createUser();
    const joiner = await createUser();
    await wallet.grantDemoStarterCredits(creator);
    await wallet.grantDemoStarterCredits(joiner);
    const demoCandidate = await createDemoMatchThroughApi(creator, key("matchmaking_demo_candidate"));
    setApiUser(joiner);
    const beforeReal = await realFinancialSnapshot();
    const response = await postJson(matchmakingApi.POST, "http://duelplay.test/api/matchmaking", {
      economyMode: "DEMO", mode: "SOLO_1V1", stake: 3, mapName: "aim_redline",
    });
    await assertApiStatus(response, 200, { scenario: "DEMO matchmaking claim", endpoint: "/api/matchmaking" });
    const payload = await response.json();
    assert.equal(payload.joined, true);
    assert.equal(payload.match.id, demoCandidate.id);
    assert.equal(payload.match.economyMode, "DEMO");
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${demoCandidate.id}::uuid AND "status" = 'ACTIVE'`), 2);
    assert.deepEqual(await realFinancialSnapshot(), beforeReal);
  });

  await check("user cancellation before LIVE releases quota and refunds the DEMO hold exactly once", async () => {
    const one = await createUser();
    await wallet.grantDemoStarterCredits(one);
    const match = await createDemoMatchThroughApi(one, key("user_cancel_match"));
    const before = await prisma.demoWallet.findUnique({ where: { userId: one } });
    setApiUser(one);
    const first = await postJson(cancelApi.POST, `http://duelplay.test/api/matches/${match.id}/cancel`, {}, {}, { id: match.id });
    await assertApiStatus(first, 200, { scenario: "user cancel pre-LIVE DEMO match", endpoint: `/api/matches/${match.id}/cancel` });
    const after = await prisma.demoWallet.findUnique({ where: { userId: one } });
    assert.equal(after.balance.toFixed(4), before.balance.plus(match.betAmount).toFixed(4));
    assert.equal(after.lockedBalance.toFixed(4), "0.0000");
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${match.id}::uuid AND "status" = 'RELEASED'`), 1);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${match.id}::uuid`), 0);
    const ledgerBeforeRetry = await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${match.id}::uuid`);
    const retry = await postJson(cancelApi.POST, `http://duelplay.test/api/matches/${match.id}/cancel`, {}, {}, { id: match.id });
    await assertApiStatus(retry, 409, { scenario: "duplicate user cancellation", endpoint: `/api/matches/${match.id}/cancel` });
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${match.id}::uuid`), ledgerBeforeRetry);
  });

  await check("application CREATE/JOIN endpoints enforce individual DEMO blocks", async () => {
    const changedBy = await createUser();
    const creator = await createUser();
    const blockedCreator = await createUser();
    await setDemoUserBlocked(blockedCreator, changedBy, true, "Blocked before create");
    setApiUser(blockedCreator);
    const beforeMatches = await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "Match"`);
    const beforeBlockedCreate = await demoUserSideEffects(blockedCreator);
    const blockedCreate = await postJson(matchesApi.POST, "http://duelplay.test/api/matches", { economyMode: "DEMO", betAmount: "3", mode: "SOLO_1V1", mapName: "aim_redline", idempotencyKey: key("blocked_create") }, { "idempotency-key": key("blocked_create") });
    await assertApiStatus(blockedCreate, 403, { scenario: "blocked user DEMO CREATE", endpoint: "/api/matches" });
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "Match"`), beforeMatches);
    assert.deepEqual(await demoUserSideEffects(blockedCreator), beforeBlockedCreate, "Blocked CREATE must not create a wallet, ledger entry, hold, quota row, or ready notification");

    await wallet.grantDemoStarterCredits(creator);
    const match = await createDemoMatchThroughApi(creator, key("blocked_join_match"));
    const blockedJoiner = await createUser();
    await wallet.grantDemoStarterCredits(blockedJoiner);
    await setDemoUserBlocked(blockedJoiner, changedBy, true, "Blocked before join");
    const beforeBlockedJoin = await demoUserSideEffects(blockedJoiner);
    const joinResponse = await joinDemoMatchThroughApi(blockedJoiner, match.id, key("blocked_join"));
    await assertApiStatus(joinResponse, 403, { scenario: "blocked user DEMO JOIN", endpoint: `/api/matches/${match.id}/join` });
    const [state] = await prisma.$queryRaw`SELECT "status"::text AS status, "playerTwoId" FROM "Match" WHERE "id" = ${match.id}::uuid`;
    assert.equal(state.status, "WAITING_FOR_PLAYERS");
    assert.equal(state.playerTwoId, null);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "userId" = ${blockedJoiner}::uuid AND "matchId" = ${match.id}::uuid`), 0);
    assert.deepEqual(await demoUserSideEffects(blockedJoiner), beforeBlockedJoin, "Blocked JOIN must not change wallet/ledger/hold/quota/usage or create a ready notification");
  });

  await check("concurrent identical application JOIN requests debit and lock the DEMO stake once", async () => {
    const one = await createUser();
    const two = await createUser();
    await wallet.grantDemoStarterCredits(one);
    await wallet.grantDemoStarterCredits(two);
    const match = await createDemoMatchThroughApi(one, key("parallel_join_match"));
    const joins = await Promise.all([
      joinDemoMatchThroughApi(two, match.id, key("parallel_join")),
      joinDemoMatchThroughApi(two, match.id, key("parallel_join")),
    ]);
    await Promise.all(joins.map(response => assertApiStatus(response, 200, { scenario: "concurrent identical DEMO JOIN", endpoint: `/api/matches/${match.id}/join` })));
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "userId" = ${two}::uuid AND "matchId" = ${match.id}::uuid AND "type" = 'MATCH_STAKE'`), 1);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${match.id}::uuid AND "walletId" IN (SELECT "id" FROM "DemoWallet" WHERE "userId" = ${two}::uuid)`), 1);
    const [state] = await prisma.$queryRaw`SELECT "playerTwoId" FROM "Match" WHERE "id" = ${match.id}::uuid`;
    assert.equal(state.playerTwoId, two);
  });

  await check("global disable blocks new DEMO creates, joins and starts while a formed match stays startable after re-enable", async () => {
    const one = await createUser();
    const two = await createUser();
    const three = await createUser();
    const four = await createUser();
    await wallet.grantDemoStarterCredits(one);
    await wallet.grantDemoStarterCredits(two);
    await wallet.grantDemoStarterCredits(four);

    // Form a match (and a second open match) while DEMO is enabled.
    await setDemoSettings({ enabled: true, dailyMatchLimit: 3 });
    const match = await createDemoMatchThroughApi(one, key("disabled_match"));
    const openMatch = await createDemoMatchThroughApi(three, key("disabled_open"));
    await assertApiStatus(await joinDemoMatchThroughApi(two, match.id, key("disabled_pair")), 200, { scenario: "join before disabling DEMO", endpoint: `/api/matches/${match.id}/join` });

    await setDemoSettings({ enabled: false, dailyMatchLimit: 3 });

    // New DEMO creation is rejected by the server and produces no match.
    const beforeMatches = await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "Match"`);
    setApiUser(two);
    const blockedCreate = await postJson(matchesApi.POST, "http://duelplay.test/api/matches", { economyMode: "DEMO", betAmount: "3", mode: "SOLO_1V1", mapName: "aim_redline", idempotencyKey: key("disabled_create") }, { "idempotency-key": key("disabled_create") });
    await assertApiStatus(blockedCreate, 409, { scenario: "DEMO create while global flag is off", endpoint: "/api/matches" });
    assert.equal((await blockedCreate.json()).errorCode, "DEMO_DISABLED");
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "Match"`), beforeMatches);

    // Joining a formed DEMO match is rejected while disabled and cannot fill it.
    const blockedJoin = await joinDemoMatchThroughApi(four, openMatch.id, key("disabled_join"));
    await assertApiStatus(blockedJoin, 409, { scenario: "DEMO join while global flag is off", endpoint: `/api/matches/${openMatch.id}/join` });
    assert.equal((await blockedJoin.json()).errorCode, "DEMO_DISABLED");
    const [openState] = await prisma.$queryRaw`SELECT "playerTwoId" FROM "Match" WHERE "id" = ${openMatch.id}::uuid`;
    assert.equal(openState.playerTwoId, null);

    // Starting the already-formed match is rejected while disabled.
    setApiUser(one);
    const blockedStart = await postJson(startApi.POST, `http://duelplay.test/api/matches/${match.id}/start`, {}, {}, { id: match.id });
    await assertApiStatus(blockedStart, 409, { scenario: "block DEMO start while global flag is off", endpoint: `/api/matches/${match.id}/start` });
    assert.equal((await blockedStart.json()).errorCode, "DEMO_DISABLED");
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${match.id}::uuid`), 0);
    const [before] = await prisma.$queryRaw`SELECT "status"::text AS status, "economyMode"::text AS "economyMode" FROM "Match" WHERE "id" = ${match.id}::uuid`;
    assert.deepEqual(before, { status: "READY", economyMode: "DEMO" });

    // Re-enabling permits the formed match to start; a later per-user block must not strand it.
    await setDemoSettings({ enabled: true, dailyMatchLimit: 3 });
    await setDemoUserBlocked(one, await createUser(), true, "Blocked after joining");
    setApiUser(one);
    const started = await postJson(startApi.POST, `http://duelplay.test/api/matches/${match.id}/start`, {}, {}, { id: match.id });
    await assertApiStatus(started, 200, { scenario: "start formed DEMO match after re-enable", endpoint: `/api/matches/${match.id}/start` });
    assert.equal((await started.json()).localTest, true);
    const [usage] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "matchId" = ${match.id}::uuid`;
    assert.equal(Number(usage.count), 2);
    const [reservations] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${match.id}::uuid AND "status" = 'CONSUMED'`;
    assert.equal(Number(reservations.count), 2);
    const duplicateStart = await postJson(startApi.POST, `http://duelplay.test/api/matches/${match.id}/start`, {}, {}, { id: match.id });
    await assertApiStatus(duplicateStart, 409, { scenario: "duplicate DEMO start", endpoint: `/api/matches/${match.id}/start` });
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "matchId" = ${match.id}::uuid`), 2);
  });

  await check("technical cancellation after LIVE refunds virtual stakes but never releases consumed daily usage", async () => {
    await setDemoSettings({ enabled: true, dailyMatchLimit: 3 });
    process.env.DUELPLAY_LOCAL_TEST_MODE = "true";
    const one = await createUser();
    const two = await createUser();
    await wallet.grantDemoStarterCredits(one);
    await wallet.grantDemoStarterCredits(two);
    const match = await createDemoMatchThroughApi(one, key("live_cancel_match"));
    await assertApiStatus(await joinDemoMatchThroughApi(two, match.id, key("live_cancel_join")), 200, { scenario: "join before technical cancellation", endpoint: `/api/matches/${match.id}/join` });
    setApiUser(one);
    const started = await postJson(startApi.POST, `http://duelplay.test/api/matches/${match.id}/start`, {}, {}, { id: match.id });
    await assertApiStatus(started, 200, { scenario: "start match before technical cancellation", endpoint: `/api/matches/${match.id}/start` });
    await lifecycle.cancelMatchWithRefund(match.id, "integration post-LIVE technical failure");
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "matchId" = ${match.id}::uuid`), 2);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${match.id}::uuid AND "status" = 'CONSUMED'`), 2);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${match.id}::uuid AND "status" = 'RELEASED'`), 0);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${match.id}::uuid AND "type" = 'MATCH_REFUND'`), 2);
  });

  await check("DEMO technical win settles virtual holds once without official progression or REAL ledger writes", async () => {
    const one = await createUser();
    const two = await createUser();
    const steamOne = "765611980000000101";
    const steamTwo = "765611980000000102";
    await prisma.user.update({ where: { id: one }, data: { steamId: steamOne } });
    await prisma.user.update({ where: { id: two }, data: { steamId: steamTwo } });
    await wallet.grantDemoStarterCredits(one);
    await wallet.grantDemoStarterCredits(two);
    const matchId = await createReadyDemoMatch(one, two);
    await prisma.match.update({ where: { id: matchId }, data: { betAmount: new Prisma.Decimal("10"), commission: new Prisma.Decimal("1"), connectionPhaseCompleted: false } });
    await policy.reserveDemoMatchStart(matchId, new Date("2026-10-12T12:00:00.000Z"));
    await wallet.reserveDemoStake(one, matchId, "10", `demo:technical-stake:${matchId}:${one}`, `demo:technical-hold:${matchId}:${one}`);
    await wallet.reserveDemoStake(two, matchId, "10", `demo:technical-stake:${matchId}:${two}`, `demo:technical-hold:${matchId}:${two}`);
    await policy.confirmDemoMatchLive(matchId, new Date("2026-10-12T12:01:00.000Z"));
    await prisma.match.update({ where: { id: matchId }, data: { serverConfig: { connectedSteamIds: [steamOne] }, connectionPhaseCompleted: false } });
    const beforeProgress = await prisma.user.findMany({ where: { id: { in: [one, two] } }, select: { id: true, xp: true, level: true, reputation: true }, orderBy: { id: "asc" } });
    const beforeReal = await realFinancialSnapshot();
    const finished = await lifecycle.resolveConnectionTimeout(matchId, steamOne);
    assert.equal(finished.status, "FINISHED");
    assert.equal(finished.winnerId, one);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${matchId}::uuid AND "status" = 'CONSUMED'`), 2);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${matchId}::uuid AND "type" = 'MATCH_WIN'`), 1);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${matchId}::uuid AND "type" = 'MATCH_FEE'`), 1);
    assert.deepEqual(await prisma.user.findMany({ where: { id: { in: [one, two] } }, select: { id: true, xp: true, level: true, reputation: true }, orderBy: { id: "asc" } }), beforeProgress);
    assert.deepEqual(await realFinancialSnapshot(), beforeReal);
    const ledgerCount = await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${matchId}::uuid`);
    assert.equal(await lifecycle.resolveConnectionTimeout(matchId, steamOne), null);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${matchId}::uuid`), ledgerCount);
  });

  await check("rejoining after leaving is blocked and does not reopen/refund the prior DEMO hold", async () => {
    const one = await createUser();
    const two = await createUser();
    await wallet.grantDemoStarterCredits(one);
    await wallet.grantDemoStarterCredits(two);
    const match = await createDemoMatchThroughApi(one, key("leave_match"));
    await assertApiStatus(await joinDemoMatchThroughApi(two, match.id, key("first_join")), 200, { scenario: "initial DEMO join before leave", endpoint: `/api/matches/${match.id}/join` });
    await setDemoUserBlocked(two, one, true, "Blocked after leaving");
    // Model the persisted state after an authorized leave has removed the player.
    await prisma.match.update({ where: { id: match.id }, data: { playerTwoId: null, status: "WAITING_FOR_PLAYERS" } });
    const response = await joinDemoMatchThroughApi(two, match.id, key("rejoin_after_block"));
    await assertApiStatus(response, 403, { scenario: "blocked user cannot rejoin DEMO match", endpoint: `/api/matches/${match.id}/join` });
    const [state] = await prisma.$queryRaw`SELECT "playerTwoId" FROM "Match" WHERE "id" = ${match.id}::uuid`;
    assert.equal(state.playerTwoId, null);
  });

  await check("server-manager LIVE callback consumes reserved quota exactly once while DEMO is disabled and settles only virtual money", async () => {
    const one = await createUser();
    const two = await createUser();
    await wallet.grantDemoStarterCredits(one);
    await wallet.grantDemoStarterCredits(two);
    const match = await createDemoMatchThroughApi(one, key("server_live_match"));
    await assertApiStatus(await joinDemoMatchThroughApi(two, match.id, key("server_live_join")), 200, { scenario: "join before server-manager LIVE callback", endpoint: `/api/matches/${match.id}/join` });
    process.env.DUELPLAY_LOCAL_TEST_MODE = "false";
    setApiUser(one);
    const startResponse = await postJson(startApi.POST, `http://duelplay.test/api/matches/${match.id}/start`, {}, {}, { id: match.id });
    await assertApiStatus(startResponse, 200, { scenario: "start DEMO match before server callback", endpoint: `/api/matches/${match.id}/start` });
    assert.equal((await startResponse.json()).status, "STARTING");
    const server = await prisma.gameServer.create({ data: { name: key("server_live"), host: "127.0.0.1", port: 54000 + (fixtureSequence % 1000), status: "STARTING", matchId: match.id } });
    await setDemoSettings({ enabled: false, dailyMatchLimit: 3 });
    process.env.DUELPLAY_SERVER_MANAGER_SECRET = "integration-server-secret";
    const readyBody = { action: "ready", serverId: server.id, host: "127.0.0.1", port: server.port };
    const ready = await postJson(serverApi.POST, `http://duelplay.test/api/matches/${match.id}/server`, readyBody, { "x-duelplay-server-secret": process.env.DUELPLAY_SERVER_MANAGER_SECRET }, { id: match.id });
    await assertApiStatus(ready, 200, { scenario: "server manager marks DEMO match LIVE", endpoint: `/api/matches/${match.id}/server` });
    assert.equal((await ready.json()).match.status, "LIVE");
    const duplicate = await postJson(serverApi.POST, `http://duelplay.test/api/matches/${match.id}/server`, readyBody, { "x-duelplay-server-secret": process.env.DUELPLAY_SERVER_MANAGER_SECRET }, { id: match.id });
    await assertApiStatus(duplicate, 200, { scenario: "duplicate server-manager LIVE callback", endpoint: `/api/matches/${match.id}/server` });
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "matchId" = ${match.id}::uuid`), 2);

    const beforeReal = await realFinancialSnapshot();
    const progressBefore = await prisma.$queryRaw`SELECT "id", "xp", "level", "reputation" FROM "User" WHERE "id" IN (${one}::uuid, ${two}::uuid) ORDER BY "id"`;
    process.env.CS2_RESULT_SECRET = "integration-result-secret";
    const resultApi = await import("../app/api/matches/[id]/result/route.ts");
    const resultResponse = await postJson(resultApi.POST, `http://duelplay.test/api/matches/${match.id}/result`, { winnerId: one }, { "x-cs2-result-secret": process.env.CS2_RESULT_SECRET }, { id: match.id });
    await assertApiStatus(resultResponse, 200, { scenario: "submit DEMO match result", endpoint: `/api/matches/${match.id}/result` });
    const progressAfter = await prisma.$queryRaw`SELECT "id", "xp", "level", "reputation" FROM "User" WHERE "id" IN (${one}::uuid, ${two}::uuid) ORDER BY "id"`;
    assert.deepEqual(progressAfter, progressBefore);
    assert.deepEqual(await realFinancialSnapshot(), beforeReal);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${match.id}::uuid AND "type" = 'MATCH_WIN'`), 1);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${match.id}::uuid AND "type" = 'MATCH_FEE'`), 1);
    const ledgerAfterFirstResult = await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${match.id}::uuid`);
    const duplicateResult = await postJson(resultApi.POST, `http://duelplay.test/api/matches/${match.id}/result`, { winnerId: one }, { "x-cs2-result-secret": process.env.CS2_RESULT_SECRET }, { id: match.id });
    await assertApiStatus(duplicateResult, 200, { scenario: "repeated DEMO CS2 result callback", endpoint: `/api/matches/${match.id}/result` });
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "matchId" = ${match.id}::uuid`), ledgerAfterFirstResult);
    assert.deepEqual(await prisma.$queryRaw`SELECT "id", "xp", "level", "reputation" FROM "User" WHERE "id" IN (${one}::uuid, ${two}::uuid) ORDER BY "id"`, progressBefore);
  });

  await check("start/cancel race leaves either a fully cancelled/refunded match or a committed start, never partial DEMO state", async () => {
    const one = await createUser();
    const two = await createUser();
    await wallet.grantDemoStarterCredits(one);
    await wallet.grantDemoStarterCredits(two);
    const match = await createDemoMatchThroughApi(one, key("race_match"));
    await assertApiStatus(await joinDemoMatchThroughApi(two, match.id, key("race_join")), 200, { scenario: "join before start/cancel race", endpoint: `/api/matches/${match.id}/join` });
    process.env.DUELPLAY_LOCAL_TEST_MODE = "false";
    setApiUser(one);
    const startPromise = postJson(startApi.POST, `http://duelplay.test/api/matches/${match.id}/start`, {}, {}, { id: match.id });
    const cancelPromise = lifecycle.cancelMatchWithRefund(match.id, "integration start/cancel race");
    const [startResponse] = await Promise.all([startPromise, cancelPromise]);
    assert.ok([200, 409].includes(startResponse.status), `start/cancel race: POST /api/matches/${match.id}/start expected HTTP 200 or 409, got ${startResponse.status}; response=${(await startResponse.clone().text()).slice(0, 400)}`);
    const [row] = await prisma.$queryRaw`SELECT "status"::text AS status FROM "Match" WHERE "id" = ${match.id}::uuid`;
    if (row.status === "CANCELLED") {
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${match.id}::uuid AND "status" = 'RELEASED'`), 2);
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${match.id}::uuid AND "status" = 'RESERVED'`), 0);
    } else {
      assert.equal(row.status, "STARTING");
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${match.id}::uuid AND "status" = 'RESERVED'`), 2);
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${match.id}::uuid AND "status" = 'ACTIVE'`), 2);
    }
  });

  await check("REAL create/join/start remain available while DEMO is disabled and never create DEMO quota records", async () => {
    const one = await createUser();
    const two = await createUser();
    await prisma.wallet.create({ data: { userId: one, balance: new Prisma.Decimal("100.0000") } });
    await prisma.wallet.create({ data: { userId: two, balance: new Prisma.Decimal("100.0000") } });
    await setDemoSettings({ enabled: false, dailyMatchLimit: 3 });
    const beforeDemo = await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction"`);
    const match = await (async () => {
      setApiUser(one);
      const response = await postJson(matchesApi.POST, "http://duelplay.test/api/matches", { economyMode: "REAL", betAmount: "3", mode: "SOLO_1V1", mapName: "aim_redline", idempotencyKey: key("real_create") }, { "idempotency-key": key("real_create") });
      await assertApiStatus(response, 201, { scenario: "REAL match creation remains available with DEMO disabled", endpoint: "/api/matches" });
      return response.json();
    })();
    await assertApiStatus(await joinDemoMatchThroughApi(two, match.id, key("real_join")), 200, { scenario: "REAL match join remains available with DEMO disabled", endpoint: `/api/matches/${match.id}/join` });
    process.env.DUELPLAY_LOCAL_TEST_MODE = "true";
    setApiUser(one);
    const start = await postJson(startApi.POST, `http://duelplay.test/api/matches/${match.id}/start`, {}, {}, { id: match.id });
    await assertApiStatus(start, 200, { scenario: "REAL match start remains available with DEMO disabled", endpoint: `/api/matches/${match.id}/start` });
    const [state] = await prisma.$queryRaw`SELECT "economyMode"::text AS "economyMode", "status"::text AS status FROM "Match" WHERE "id" = ${match.id}::uuid`;
    assert.deepEqual(state, { economyMode: "REAL", status: "LIVE" });
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchStartReservation" WHERE "matchId" = ${match.id}::uuid`), 0);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoMatchUsage" WHERE "matchId" = ${match.id}::uuid`), 0);
    assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction"`), beforeDemo);
  });
}

async function runDemoWalletPostgresIntegration() {
  try {
    const game = await prisma.game.findUnique({ where: { slug: "cs2" }, select: { id: true } })
      ?? await prisma.game.create({ data: { slug: "cs2", title: "Counter-Strike 2 integration fixture", config: {} }, select: { id: true } });
    fixtureGameId = game.id;

    const beforeRealFinance = await realFinancialSnapshot();
    await check("transactions use more than one live PostgreSQL connection", testRealConcurrentConnections);
    await runDemoPolicyIntegrationTests(await createUser());
    await runDemoDisputeIntegrationTests();

    await check("concurrent first wallet creation creates one wallet", async () => {
      const userId = await createUser();
      const results = await Promise.all(Array.from({ length: 24 }, () => wallet.getOrCreateDemoWallet(userId)));
      assert.equal(new Set(results.map(result => result.id)).size, 1, "Every caller must receive the same wallet ID");
      for (const result of results) {
        assert.equal(result.balance.toString(), "0");
        assert.equal(result.lockedBalance.toString(), "0");
      }
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`), 1);
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "userId" = ${userId}::uuid AND "type" = 'STARTER_GRANT'`), 0,
        "Wallet creation alone must not issue a starter grant");
    });

    await check("concurrent starter grants create exactly one grant and balance increase", async () => {
      const userId = await createUser();
      const results = await Promise.all(Array.from({ length: 32 }, () => wallet.grantDemoStarterCredits(userId)));
      assert.equal(results.filter(result => result.idempotent).length, 31);
      assert.equal(new Set(results.map(result => result.wallet.id)).size, 1, "Every grant caller must use the same wallet");
      const [row] = await prisma.$queryRaw`SELECT "balance"::text AS balance FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`;
      assert.equal(row.balance, "10000.0000");
      const [ledger] = await prisma.$queryRaw`
        SELECT count(*)::int AS count, min("amount")::text AS amount,
          min("balanceBefore")::text AS "balanceBefore", min("balanceAfter")::text AS "balanceAfter"
        FROM "DemoTransaction" WHERE "userId" = ${userId}::uuid AND "type" = 'STARTER_GRANT'
      `;
      assert.equal(Number(ledger.count), 1);
      assert.equal(ledger.amount, "10000.0000");
      assert.equal(ledger.balanceBefore, "0.0000");
      assert.equal(ledger.balanceAfter, "10000.0000");
    });

    await check("unrelated unique violations during wallet creation are not swallowed", async () => {
      const userId = await createUser();
      await makeWalletUniqueFailureTrigger();
      await assert.rejects(wallet.getOrCreateDemoWallet(userId), error => {
        const diagnostic = [error?.code, error?.message, error?.meta?.code, error?.meta?.message].join(" ");
        return /P2002|P2010|23505|injected unrelated wallet unique constraint/i.test(diagnostic);
      });
      await dropFaultTriggers();
      triggerNames.length = 0;
      functionNames.length = 0;
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`), 0,
        "Failed wallet creation must not leave a partial row");
    });

    await check("competing stake debits cannot overspend and ledger matches committed operations", async () => {
      const userId = await createUser();
      await wallet.grantDemoStarterCredits(userId);
      const matches = await Promise.all(Array.from({ length: 14 }, () => createMatch(userId)));
      const outcomes = await Promise.allSettled(matches.map((matchId, index) =>
        wallet.reserveDemoStake(userId, matchId, "1000.0000", key(`overdraw_debit_${index}`), key(`overdraw_hold_${index}`))));
      const successes = outcomes.filter(result => result.status === "fulfilled");
      const failures = outcomes.filter(result => result.status === "rejected");
      assert.equal(successes.length, 10);
      assert.equal(failures.length, 4);
      for (const result of failures) assert.match(String(result.reason), /INSUFFICIENT_DEMO_BALANCE/);
      const [balances] = await prisma.$queryRaw`SELECT "balance"::text AS balance, "lockedBalance"::text AS locked FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`;
      assert.equal(balances.balance, "0.0000");
      assert.equal(balances.locked, "10000.0000");
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "userId" = ${userId}::uuid AND "type" = 'MATCH_STAKE'`), 10);
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "walletId" IN (SELECT "id" FROM "DemoWallet" WHERE "userId" = ${userId}::uuid) AND "status" = 'ACTIVE'`), 10);
    });

    await check("same debit key/payload is idempotent and different payload conflicts", async () => {
      const userId = await createUser();
      await wallet.grantDemoStarterCredits(userId);
      const matchId = await createMatch(userId);
      const debitKey = key("same_debit");
      const holdKey = key("same_hold");
      const results = await Promise.all([
        wallet.reserveDemoStake(userId, matchId, "125.5000", debitKey, holdKey),
        wallet.reserveDemoStake(userId, matchId, "125.5000", debitKey, holdKey),
      ]);
      assert.equal(results.filter(result => result.idempotent).length, 1);
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "idempotencyKey" = ${debitKey}`), 1);
      await rejected(wallet.reserveDemoStake(userId, matchId, "126.5000", debitKey, holdKey), /IDEMPOTENCY_CONFLICT/);
      const [row] = await prisma.$queryRaw`SELECT "balance"::text AS balance FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`;
      assert.equal(row.balance, "9874.5000");
    });

    await check("opposite participant input orders use ascending wallet lock order without deadlock", async () => {
      const userOne = await createUser();
      const userTwo = await createUser();
      const matchId = await createMatch(userOne, "DEMO", userTwo);
      for (const userId of [userOne, userTwo]) {
        await wallet.grantDemoStarterCredits(userId);
        await wallet.reserveDemoStake(userId, matchId, "100", key(`ordered_debit_${userId}`), key(`ordered_hold_${userId}`));
      }

      const settleInCallerOrder = (inputOrder) => wallet.withDemoTransaction(async ({ db, demo }) => {
        await db.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        // The service documents that composite multi-wallet operations must
        // sort userIds before taking locks. Inputs intentionally oppose each
        // other so this tests that settlement contract on real row locks.
        for (const userId of [...inputOrder].sort()) {
          await demo.closeDemoWalletHold(userId, matchId, "100", key(`ordered_close_${userId}`), "CONSUMED");
        }
      });
      const ids = [userOne, userTwo].sort();
      await Promise.all([settleInCallerOrder(ids), settleInCallerOrder([...ids].reverse())]);
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${matchId}::uuid AND "status" = 'CONSUMED'`), 2);
    });

    await check("reserve rollback after failed debit ledger insert restores wallet", async () => {
      const userId = await createUser();
      await wallet.grantDemoStarterCredits(userId);
      const matchId = await createMatch(userId);
      const debitKey = key("rollback_debit_ledger");
      await makeTrigger("DemoTransaction", `${prefix}_fail_debit_ledger`, `${prefix}_fail_debit_ledger_fn`, debitKey);
      await rejected(wallet.reserveDemoStake(userId, matchId, "250", debitKey, key("rollback_debit_hold")), /integration fault injection/);
      const [row] = await prisma.$queryRaw`SELECT "balance"::text AS balance, "lockedBalance"::text AS locked FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`;
      assert.equal(row.balance, "10000.0000");
      assert.equal(row.locked, "0.0000");
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "matchId" = ${matchId}::uuid`), 0);
      await dropFaultTriggers();
      triggerNames.length = 0;
      functionNames.length = 0;
    });

    await check("reserve rollback after failed hold insert reverts debit, ledger and wallet", async () => {
      const userId = await createUser();
      await wallet.grantDemoStarterCredits(userId);
      const matchId = await createMatch(userId);
      const holdKey = key("rollback_hold_insert");
      await makeTrigger("DemoWalletHold", `${prefix}_fail_hold_insert`, `${prefix}_fail_hold_insert_fn`, holdKey);
      await rejected(wallet.reserveDemoStake(userId, matchId, "350", key("rollback_hold_debit"), holdKey), /integration fault injection/);
      const [row] = await prisma.$queryRaw`SELECT "balance"::text AS balance, "lockedBalance"::text AS locked FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`;
      assert.equal(row.balance, "10000.0000");
      assert.equal(row.locked, "0.0000");
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "idempotencyKey" = ${key("rollback_hold_debit")}`), 0);
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoWalletHold" WHERE "idempotencyKey" = ${holdKey}`), 0);
      await dropFaultTriggers();
      triggerNames.length = 0;
      functionNames.length = 0;
    });

    await check("refund and consume race closes a hold once; a closed hold cannot reopen", async () => {
      const userId = await createUser();
      await wallet.grantDemoStarterCredits(userId);
      const matchId = await createMatch(userId);
      const debitKey = key("hold_race_debit");
      const holdKey = key("hold_race_hold");
      await wallet.reserveDemoStake(userId, matchId, "500", debitKey, holdKey);
      const closures = await Promise.allSettled([
        wallet.closeDemoWalletHold(userId, matchId, "500", key("hold_race_refund"), "RELEASED"),
        wallet.closeDemoWalletHold(userId, matchId, "500", key("hold_race_consume"), "CONSUMED"),
      ]);
      assert.equal(closures.filter(item => item.status === "fulfilled").length, 1);
      assert.equal(closures.filter(item => item.status === "rejected").length, 1);
      const [hold] = await prisma.$queryRaw`SELECT "status"::text AS status FROM "DemoWalletHold" WHERE "idempotencyKey" = ${holdKey}`;
      assert.ok(["RELEASED", "CONSUMED"].includes(hold.status));
      const [walletRow] = await prisma.$queryRaw`SELECT "balance"::text AS balance, "lockedBalance"::text AS locked FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`;
      const expectedBalance = hold.status === "RELEASED" ? "10000.0000" : "9500.0000";
      assert.equal(walletRow.balance, expectedBalance);
      assert.equal(walletRow.locked, "0.0000");
      await rejected(wallet.reserveDemoStake(userId, matchId, "500", debitKey, holdKey), /DEMO_HOLD_ALREADY_CLOSED/);
      const [afterRetry] = await prisma.$queryRaw`SELECT "balance"::text AS balance, "lockedBalance"::text AS locked FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`;
      assert.deepEqual(afterRetry, walletRow);
    });

    await check("concurrent fee keys insert once; duplicate payload is idempotent and mismatch conflicts", async () => {
      const userId = await createUser();
      const matchId = await createMatch(userId);
      const feeKey = key("fee_shared");
      const results = await Promise.all(Array.from({ length: 20 }, () => wallet.recordDemoMatchFee(matchId, "12.3456", feeKey)));
      assert.equal(results.filter(result => result.idempotent).length, 19);
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "idempotencyKey" = ${feeKey}`), 1);
      await rejected(wallet.recordDemoMatchFee(matchId, "12.3457", feeKey), /IDEMPOTENCY_CONFLICT/);
    });

    await check("composed Match and wallet settlement rolls back as one transaction", async () => {
      const userId = await createUser();
      await wallet.grantDemoStarterCredits(userId);
      const matchId = await createMatch(userId);
      const debitKey = key("settlement_debit");
      const holdKey = key("settlement_hold");
      await wallet.reserveDemoStake(userId, matchId, "725", debitKey, holdKey);
      const [before] = await prisma.$queryRaw`SELECT "balance"::text AS balance, "lockedBalance"::text AS locked FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`;
      await assert.rejects(wallet.withDemoTransaction(async ({ db, demo }) => {
        await demo.closeDemoWalletHold(userId, matchId, "725", key("settlement_refund"), "RELEASED");
        await db.$executeRaw`UPDATE "Match" SET "status" = 'FINISHED'::"MatchStatus", "updatedAt" = NOW() WHERE "id" = ${matchId}::uuid`;
        throw new Error("INJECTED_SETTLEMENT_ROLLBACK");
      }), /INJECTED_SETTLEMENT_ROLLBACK/);
      const [after] = await prisma.$queryRaw`SELECT "balance"::text AS balance, "lockedBalance"::text AS locked FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`;
      const [match] = await prisma.$queryRaw`SELECT "status"::text AS status FROM "Match" WHERE "id" = ${matchId}::uuid`;
      const [hold] = await prisma.$queryRaw`SELECT "status"::text AS status FROM "DemoWalletHold" WHERE "idempotencyKey" = ${holdKey}`;
      assert.deepEqual(after, before);
      assert.equal(match.status, "CREATING");
      assert.equal(hold.status, "ACTIVE");
      assert.equal(await count(prisma.$queryRaw`SELECT count(*)::int AS count FROM "DemoTransaction" WHERE "idempotencyKey" = ${key("settlement_refund")}`), 0);
    });

    await check("database constraints and triggers reject invalid DEMO state", async () => {
      const userId = await createUser();
      await wallet.grantDemoStarterCredits(userId);
      const matchId = await createMatch(userId);
      const realMatchId = await createMatch(userId, "REAL");
      const [demoWallet] = await prisma.$queryRaw`SELECT "id" FROM "DemoWallet" WHERE "userId" = ${userId}::uuid`;

      await rejected(prisma.$executeRaw`UPDATE "DemoWallet" SET "balance" = -1 WHERE "id" = ${demoWallet.id}::uuid`, /DemoWallet_balance_nonnegative/);
      await rejected(prisma.$executeRaw`
        INSERT INTO "DemoWallet" ("userId", "updatedAt") VALUES (${randomUUID()}::uuid, NOW())
      `, /DemoWallet_userId_fkey/);
      await rejected(prisma.$executeRaw`
        INSERT INTO "DemoTransaction" ("matchId", "type", "amount", "idempotencyKey")
        VALUES (${matchId}::uuid, 'MATCH_FEE'::"DemoTransactionType", 1, '   ')
      `, /DemoTransaction_idempotencyKey_nonempty/);
      await rejected(prisma.$executeRaw`
        INSERT INTO "DemoWalletHold" ("walletId", "matchId", "amount", "idempotencyKey")
        VALUES (${demoWallet.id}::uuid, ${matchId}::uuid, 1, '   ')
      `, /DemoWalletHold_idempotencyKey_nonempty/);
      await rejected(prisma.$executeRaw`
        INSERT INTO "DemoTransaction" ("matchId", "type", "amount", "idempotencyKey")
        VALUES (${realMatchId}::uuid, 'MATCH_FEE'::"DemoTransactionType", 1, ${key("real_match_fee")})
      `, /DEMO finance may only reference DEMO matches/);
      await rejected(prisma.$executeRaw`
        INSERT INTO "DemoTransaction" ("walletId", "userId", "matchId", "type", "amount", "balanceBefore", "balanceAfter", "idempotencyKey")
        VALUES (${demoWallet.id}::uuid, ${userId}::uuid, ${realMatchId}::uuid, 'MATCH_WIN'::"DemoTransactionType", 1, 0, 1, ${key("real_match_win")})
      `, /DEMO finance may only reference DEMO matches/);
      await rejected(prisma.$executeRaw`
        INSERT INTO "DemoWalletHold" ("walletId", "matchId", "amount", "idempotencyKey")
        VALUES (${demoWallet.id}::uuid, ${realMatchId}::uuid, 1, ${key("real_match_hold")})
      `, /DEMO finance may only reference DEMO matches/);

      const [fee] = await prisma.$queryRaw`
        INSERT INTO "DemoTransaction" ("matchId", "type", "amount", "idempotencyKey")
        VALUES (${matchId}::uuid, 'MATCH_FEE'::"DemoTransactionType", 1, ${key("immutable_fee")})
        RETURNING "id"
      `;
      await rejected(prisma.$executeRaw`UPDATE "DemoTransaction" SET "amount" = 2 WHERE "id" = ${fee.id}::uuid`, /append-only/);
      await rejected(prisma.$executeRaw`DELETE FROM "DemoTransaction" WHERE "id" = ${fee.id}::uuid`, /append-only/);
      await rejected(prisma.$executeRaw`UPDATE "Match" SET "economyMode" = 'REAL'::"MatchEconomyMode" WHERE "id" = ${matchId}::uuid`, /economyMode is immutable/);

      const holdMatch = await createMatch(userId);
      await wallet.reserveDemoStake(userId, holdMatch, "10", key("sql_hold_debit"), key("sql_hold_key"));
      await wallet.closeDemoWalletHold(userId, holdMatch, "10", key("sql_hold_close"), "RELEASED");
      await rejected(prisma.$executeRaw`UPDATE "DemoWalletHold" SET "status" = 'ACTIVE'::"DemoWalletHoldStatus", "closedAt" = NULL WHERE "idempotencyKey" = ${key("sql_hold_key")}`, /cannot be reopened/);
      await rejected(prisma.$executeRaw`UPDATE "DemoWalletHold" SET "amount" = 11 WHERE "idempotencyKey" = ${key("sql_hold_key")}`, /cannot be reopened|identity is immutable/);
    });

    await check("DEMO operations do not touch REAL wallet, ledger, deposit or withdrawal tables", async () => {
      assert.deepEqual(await realFinancialSnapshot(), beforeRealFinance);
    });
    await runDemoMatchApplicationIntegrationTests();
  } finally {
    await dropFaultTriggers();
    await prisma.$disconnect();
  }
  console.log(`Completed ${checks} genuine PostgreSQL integration scenarios.`);
}

async function runServerTechnicalEventsPostgresIntegration() {
  const priorSecret = process.env.DUELPLAY_SERVER_MANAGER_SECRET;
  const priorAdminSession = globalThis.__DUELPLAY_TEST_ADMIN_SESSION__;
  const secret = `it-secret-${randomUUID()}`;
  const serverName = `it-cs2-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const tempRoot = mkdtempSync(joinPath(os.tmpdir(), "duelplay-events-it-"));
  let supportUserId;
  let adminUserId;
  process.env.DUELPLAY_SERVER_MANAGER_SECRET = secret;
  try {
    await prisma.gameServer.create({ data: { name: serverName, host: "127.0.0.1", port: 39000 + Math.floor(Math.random() * 2000) } });
    let capturedEvent;
    const outbox = createTechnicalEventOutbox({
      apiUrl: "http://duelplay.test",
      secret,
      serverId: serverName,
      filePath: joinPath(tempRoot, "events.json"),
      fetchImpl: async (_url, init) => {
        capturedEvent = JSON.parse(init.body);
        const request = new (await import("next/server")).NextRequest("http://duelplay.test/api/server-manager/events", {
          method: "POST",
          headers: { ...init.headers, "x-forwarded-for": "203.0.113.10" },
          body: init.body,
        });
        return serverEventsApi.POST(request);
      },
    });

    await check("outbox event traverses authenticated API and persists sanitized event plus incident", async () => {
      assert.equal(await outbox.emit({ source: "server-manager", category: "startup", severity: "ERROR", message: "component failed", details: { token: "do-not-store", context: "safe" } }), true);
      assert.ok(capturedEvent?.eventId);
      const stored = await prisma.serverTechnicalEvent.findUnique({ where: { eventId: capturedEvent.eventId } });
      assert.ok(stored);
      assert.equal(stored.serverName, serverName);
      assert.deepEqual(stored.details, { context: "safe" });
      assert.ok(stored.incidentId);
      const incident = await prisma.serverIncident.findUnique({ where: { id: stored.incidentId } });
      assert.equal(incident.occurrences, 1);
    });

    await check("incident deduplication increments occurrence count for another event", async () => {
      await outbox.emit({ source: "server-manager", category: "startup", severity: "ERROR", message: "component failed again" });
      const incident = await prisma.serverIncident.findUnique({ where: { dedupeKey: createHash("sha256").update(`${serverName}\0server-manager\0startup`).digest("hex") } });
      assert.equal(incident.occurrences, 2);
      assert.equal(await prisma.serverTechnicalEvent.count({ where: { serverName } }), 2);
    });

    await check("ingest rejects missing authentication and unregistered server", async () => {
      const { NextRequest } = await import("next/server");
      const payload = { ...capturedEvent, eventId: randomUUID() };
      const unauthorized = await serverEventsApi.POST(new NextRequest("http://duelplay.test/api/server-manager/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
      assert.equal(unauthorized.status, 401);
      const unknown = await serverEventsApi.POST(new NextRequest("http://duelplay.test/api/server-manager/events", { method: "POST", headers: { "content-type": "application/json", "x-duelplay-server-secret": secret, "x-forwarded-for": "203.0.113.11" }, body: JSON.stringify({ ...payload, eventId: randomUUID(), serverId: `${serverName}-missing` }) }));
      assert.equal(unknown.status, 404);
    });

    await check("admin event and incident APIs enforce RBAC and expose persisted data", async () => {
      supportUserId = await createUser();
      await prisma.user.update({ where: { id: supportUserId }, data: { role: "SUPPORT", twoFactorEnabled: true } });
      globalThis.__DUELPLAY_TEST_ADMIN_SESSION__ = { user: { id: supportUserId, twoFactorEnabled: true }, adminMfaVerifiedAt: new Date() };
      const { NextRequest } = await import("next/server");
      const denied = await adminServerEventsApi.GET(new NextRequest(`http://duelplay.test/api/admin/server-events?server=${serverName}`));
      assert.equal(denied.status, 403);

      adminUserId = await createUser();
      await prisma.user.update({ where: { id: adminUserId }, data: { role: "SUPERADMIN", twoFactorEnabled: true } });
      globalThis.__DUELPLAY_TEST_ADMIN_SESSION__ = { user: { id: adminUserId, twoFactorEnabled: true }, adminMfaVerifiedAt: new Date() };
      const events = await adminServerEventsApi.GET(new NextRequest(`http://duelplay.test/api/admin/server-events?server=${serverName}`));
      assert.equal(events.status, 200);
      const eventBody = await events.json();
      assert.equal(eventBody.items.length, 2);
      const incidents = await adminServerIncidentsApi.GET(new NextRequest(`http://duelplay.test/api/admin/server-incidents?server=${serverName}`));
      assert.equal(incidents.status, 200);
      const incidentBody = await incidents.json();
      assert.equal(incidentBody.items.length, 1);
      assert.equal(incidentBody.items[0].occurrences, 2);
    });
  } finally {
    globalThis.__DUELPLAY_TEST_ADMIN_SESSION__ = priorAdminSession;
    if (priorSecret === undefined) delete process.env.DUELPLAY_SERVER_MANAGER_SECRET;
    else process.env.DUELPLAY_SERVER_MANAGER_SECRET = priorSecret;
    await prisma.serverTechnicalEvent.deleteMany({ where: { serverName } }).catch(() => {});
    await prisma.serverIncident.deleteMany({ where: { serverName } }).catch(() => {});
    await prisma.gameServer.deleteMany({ where: { name: serverName } }).catch(() => {});
    if (supportUserId) await prisma.user.deleteMany({ where: { id: supportUserId } }).catch(() => {});
    if (adminUserId) await prisma.user.deleteMany({ where: { id: adminUserId } }).catch(() => {});
    rmSync(tempRoot, { recursive: true, force: true });
    await prisma.$disconnect();
  }
  console.log(`Completed ${checks} PostgreSQL integration scenarios, including server technical events.`);
}

export { runDemoWalletPostgresIntegration, runServerTechnicalEventsPostgresIntegration };
