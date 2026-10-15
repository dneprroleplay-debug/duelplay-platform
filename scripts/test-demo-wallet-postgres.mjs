import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPT_IN = "DUELPLAY_DEMO_WALLET_INTEGRATION";
const OWNED_LABEL = "duelplay.demo-wallet.integration";
const OWNER_LABEL = "duelplay.demo-wallet.owner";
// Explicit reviewed allowlist. Update these constants only after reviewing the
// migration diff and intentionally approving a new migration-chain contract.
const EXPECTED_MIGRATIONS = Object.freeze({
  "00000000000000_duelplay_baseline": "6dfe520632c051155d2fe12dd56c6e3d782543ff610407ba1b2de786261bd202",
  "20261008160000_add_admin_role_assignment": "197a8bfe30fd6053b98a25b60d111532116b29f3291a5becdc3b36accf8412df",
  "20261012120000_demo_economy_foundation": "69fc2d9fa672943015230aa8587b2d78076d8c6976916acd0543a549c4e42581",
  "20261012153000_add_demo_policy_quota": "550300a9f10989f82c56419e8476767583899465ce424c9ced83a081707338f9",
  "20261013090000_add_demo_dispute_enum_values": "93af2935159e45bd9acbfc4e6f01d6ddac2ef166154f703394331f2e04070c1e",
  "20261013100000_demo_dispute_accounting_lifecycle": "3af8ce5cf6bea4f120933c84f777d1a6baa497077f73535a26bc43c617d408bd",
  "20261015110000_server_technical_events": "0f36c235aa960dc7501cfe744c5af6bb195cd9ae09b042697d11c2f9122b01b8",
});
const EXPECTED_MIGRATION_LOCK_SHA256 = "99836963713b4f5b269ad49af0ed3d7b0b2e336115c2f92dc9ac683d139d0900";

let dockerPath = "docker";
let containerName;
let containerId;
let ownerToken;
let containerCreatedByThisRun = false;
let dotenvGuardFile;
let dotenvGuardCreated = false;
let temporaryDatabaseUrl;
let originalDatabaseUrl;
let originalDatabaseUrlWasSet = false;
let cleanupPromise;
let interrupted = false;

function fail(message) {
  throw new Error(message);
}

function assertOptIn() {
  if (process.env[OPT_IN] !== "1" && process.env.DUELPLAY_SERVER_EVENTS_INTEGRATION !== "1") {
    fail(`Refusing to run. Set $env:${OPT_IN}='1' or $env:DUELPLAY_SERVER_EVENTS_INTEGRATION='1' explicitly for this invocation.`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
    env: options.env ?? safeChildEnvironment(),
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function docker(args, options = {}) {
  const result = run(dockerPath, args, options);
  if (result.status !== 0 && !options.allowFailure) {
    const output = `${result.stdout}${result.stderr}`.trim();
    fail(`Docker command failed (${args[0] ?? "docker"}, exit ${result.status ?? "unknown"}). ${output}`);
  }
  return result;
}

function safeChildEnvironment(extra = {}) {
  // Explicit allowlist: in particular, never inherit DATABASE_URL or other
  // project dotenv settings. The only DB URL supplied is generated below.
  const names = ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "PATHEXT", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
  const env = {};
  for (const name of names) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, ...extra };
}

function verifyMigrationChain() {
  const lockPath = path.join(root, "prisma", "migrations", "migration_lock.toml");
  const lockBytes = fs.readFileSync(lockPath);
  const lock = lockBytes.toString("utf8");
  assert.equal(sha256(lockBytes), EXPECTED_MIGRATION_LOCK_SHA256, "Migration lock content changed; review before applying anything");
  assert.match(lock, /^provider\s*=\s*"postgresql"\s*$/m, "Migration lock must pin the schema provider");

  const migrationsRoot = path.join(root, "prisma", "migrations");
  const found = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  assert.deepEqual(found, Object.keys(EXPECTED_MIGRATIONS).sort(), "Active migration set changed; review before applying anything");
  for (const [name, expectedHash] of Object.entries(EXPECTED_MIGRATIONS)) {
    const sql = path.join(migrationsRoot, name, "migration.sql");
    assert.ok(fs.lstatSync(sql).isFile(), `Missing regular migration SQL file: ${name}/migration.sql`);
    assert.equal(sha256(fs.readFileSync(sql)), expectedHash, `Migration SQL changed: ${name}/migration.sql`);
  }
  assert.match(fs.readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8"), /provider\s*=\s*"postgresql"/);
  assert.equal(fs.readFileSync(path.join(root, "prisma.config.ts"), "utf8").includes('import "dotenv/config"'), true,
    "Runner's isolated DOTENV_CONFIG_PATH guard must be reviewed if Prisma config changes");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function verifyDockerAvailable() {
  const explicit = process.env.DUELPLAY_DOCKER_BIN;
  if (explicit) {
    if (!path.isAbsolute(explicit)) fail("DUELPLAY_DOCKER_BIN must be an absolute executable path.");
    dockerPath = explicit;
  }
  const result = docker(["version", "--format", "{{.Server.Version}}"], { allowFailure: true });
  if (result.status !== 0 || !result.stdout.trim()) {
    fail("Docker client/server is unavailable to this PowerShell process. No database action was attempted.");
  }
  const contextResult = docker(["context", "show"], { allowFailure: true });
  if (contextResult.status !== 0) fail("Could not identify the Docker context; refusing to create a test container.");
  const contextName = contextResult.stdout.trim();
  const endpointResult = docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}", contextName], { allowFailure: true });
  if (endpointResult.status !== 0) fail("Could not verify the Docker daemon endpoint; refusing to create a test container.");
  const endpoint = endpointResult.stdout.trim();
  const isLocalDockerDesktop = /^npipe:\/\/\/\/\.\/pipe\/dockerDesktopLinuxEngine$/i.test(endpoint);
  const isLocalUnixSocket = endpoint === "unix:///var/run/docker.sock";
  if (!isLocalDockerDesktop && !isLocalUnixSocket) {
    fail("Docker context is not a recognized local Docker Desktop/Linux socket; no container was created.");
  }
}

function inspectContainerById(id) {
  if (!/^[a-f0-9]{64}$/i.test(id ?? "")) fail("No valid immutable container ID is available; refusing to inspect or remove a resource.");
  const inspected = docker(["inspect", id], { allowFailure: true });
  if (inspected.status !== 0) {
    fail("Docker could not verify the saved container ID; refusing cleanup or database work.");
  }
  let parsed;
  try {
    parsed = JSON.parse(inspected.stdout);
  } catch {
    fail("Docker inspect returned invalid data; refusing cleanup.");
  }
  const container = parsed[0];
  if (!container || container.Id?.toLowerCase() !== id.toLowerCase()) fail("Inspected immutable container ID does not match this run.");
  if (container.Name !== `/${containerName}`) fail("Inspected container identity does not match the generated test name.");
  if (container.Config?.Labels?.[OWNED_LABEL] !== "true" || container.Config?.Labels?.[OWNER_LABEL] !== ownerToken) {
    fail("Container ownership labels do not match this run; refusing to touch it.");
  }
  return container;
}

function findExactContainerName() {
  // Docker's name filter is a Go regular expression; anchors prevent a prefix
  // or substring match from being treated as a collision or ownership proof.
  const result = docker(["container", "ls", "--all", "--no-trunc", "--filter", `name=^/${containerName}$`, "--format", "{{.ID}}"], { allowFailure: true });
  if (result.status !== 0) fail("Could not reliably check the generated container name; refusing to create resources.");
  const ids = result.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (ids.some(id => !/^[a-f0-9]{64}$/i.test(id))) fail("Docker returned an invalid ID during exact-name check; refusing to create resources.");
  return ids;
}

function adoptPartiallyCreatedContainerIfOwned() {
  if (!containerName || !ownerToken) return;
  const ids = findExactContainerName();
  if (ids.length === 0) return;
  if (ids.length !== 1) fail("Multiple containers match this run's exact generated name; refusing to adopt or remove any resource.");
  const candidate = inspectContainerById(ids[0]);
  if (candidate.Config?.Labels?.[OWNED_LABEL] !== "true" || candidate.Config?.Labels?.[OWNER_LABEL] !== ownerToken) {
    fail("A container has the generated name but does not prove this run's ownership; refusing to adopt or remove it.");
  }
  containerId = candidate.Id;
  containerCreatedByThisRun = true;
}

function verifyContainerCreateConfiguration(container) {
  assert.ok(container, "Test container was not created");
  assert.equal(container.Config?.Image, "postgres:16-alpine", "Unexpected PostgreSQL image");
  const tmpfs = container.HostConfig?.Tmpfs ?? {};
  assert.deepEqual(Object.keys(tmpfs).sort(), ["/var/lib/postgresql/data"], "Only the PostgreSQL data directory may use tmpfs");
  assert.match(tmpfs["/var/lib/postgresql/data"] ?? "", /^rw,noexec,nosuid,size=512m$/, "Unexpected tmpfs configuration");
  assert.equal((container.HostConfig?.Binds ?? []).length, 0, "Persistent bind mounts are forbidden");
  assert.equal((container.HostConfig?.Mounts ?? []).length, 0, "Docker volume mounts are forbidden");
  const portBindings = container.HostConfig?.PortBindings ?? {};
  assert.deepEqual(Object.keys(portBindings).sort(), ["5432/tcp"], "Only PostgreSQL's container port may be published");
  assert.equal(portBindings["5432/tcp"]?.length, 1, "Exactly one PostgreSQL port binding is required");
  assert.equal(portBindings["5432/tcp"][0]?.HostIp, "127.0.0.1", "PostgreSQL must be bound only to loopback");
}

function verifyContainerIsolation(container) {
  verifyContainerCreateConfiguration(container);
  assert.ok(Array.isArray(container.Mounts), "Docker inspect did not provide an effective mount list");
  assert.equal(container.Mounts.length, 0, "Persistent volume or bind mounts are forbidden");
  const bindings = container.NetworkSettings?.Ports?.["5432/tcp"] ?? [];
  assert.equal(bindings.length, 1, "Expected exactly one published PostgreSQL port");
  assert.equal(bindings[0].HostIp, "127.0.0.1", "PostgreSQL must be bound only to loopback");
  assert.match(bindings[0].HostPort, /^\d+$/);
  const unexpectedPublishedPorts = Object.entries(container.NetworkSettings?.Ports ?? {})
    .filter(([port, mappings]) => port !== "5432/tcp" && mappings?.length);
  assert.equal(unexpectedPublishedPorts.length, 0, "No additional container ports may be published");
  return Number(bindings[0].HostPort);
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    if (dotenvGuardFile && dotenvGuardCreated) {
      try { fs.unlinkSync(dotenvGuardFile); } catch (error) { if (error.code !== "ENOENT") console.error("Could not remove runner-owned dotenv guard file."); }
      dotenvGuardFile = undefined;
      dotenvGuardCreated = false;
    }
    if (!containerCreatedByThisRun || !containerId) return;
    try {
      const container = inspectContainerById(containerId);
      assert.equal(container.Id.toLowerCase(), containerId.toLowerCase());
      const removed = docker(["rm", "--force", "--volumes", containerId], { allowFailure: true });
      if (removed.status !== 0) fail("Docker did not confirm removal of the verified container ID.");
      const remaining = docker(["container", "ls", "--all", "--no-trunc", "--filter", `id=${containerId}`, "--format", "{{.ID}}"], { allowFailure: true });
      if (remaining.status !== 0 || remaining.stdout.trim()) fail("Could not confirm removal by immutable container ID.");
      containerCreatedByThisRun = false;
      containerId = undefined;
      console.log("Removed the runner-owned ephemeral PostgreSQL container.");
    } catch {
      console.error(`Cleanup could not prove ownership or confirm removal. No other resource will be removed. Inspect generated container ${containerName ?? "<unknown>"} manually.`);
      process.exitCode = 1;
    }
  })();
  return cleanupPromise;
}

async function waitForPostgres(dbUser, dbName, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const result = docker(["exec", containerId, "pg_isready", "-q", "-U", dbUser, "-d", dbName], { allowFailure: true, timeout: 10_000 });
    if (result.status === 0) return;
    if (interrupted) fail("Interrupted while waiting for PostgreSQL readiness.");
    await delay(750);
  }
  fail("Timed out waiting for the isolated PostgreSQL server to become ready.");
}

function runPrisma(args, databaseUrl) {
  const cli = path.join(root, "node_modules", "prisma", "build", "index.js");
  assert.ok(fs.existsSync(cli), "Local Prisma CLI is not installed");
  const result = run(process.execPath, [cli, ...args], {
    timeout: 5 * 60_000,
    env: safeChildEnvironment({
      DATABASE_URL: databaseUrl,
      DOTENV_CONFIG_PATH: dotenvGuardFile,
      DOTENV_CONFIG_OVERRIDE: "false",
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    }),
  });
  const scrubbed = `${result.stdout}${result.stderr}`.split(databaseUrl).join("<isolated-test-database-url>");
  if (scrubbed.trim()) process.stdout.write(scrubbed);
  if (result.status !== 0) fail(`Prisma ${args[0]} failed with exit ${result.status ?? "unknown"}.`);
}

async function main() {
  assertOptIn();
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name, "duelplay-app",
    "Run this script from the DuelPlay project root");
  verifyMigrationChain();
  verifyDockerAvailable();

  const suffix = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  containerName = `duelplay-demo-pg-it-${suffix}`;
  ownerToken = randomBytes(24).toString("hex");
  const dbName = `dpdemo_${randomBytes(8).toString("hex")}`;
  const dbUser = `dpuser_${randomBytes(8).toString("hex")}`;
  const dbPassword = randomBytes(32).toString("hex");

  const existingIds = findExactContainerName();
  if (existingIds.length > 0) fail("Generated container name is already occupied; refusing to reuse or inspect it as an owned resource.");

  dotenvGuardFile = path.join(os.tmpdir(), `duelplay-dotenv-empty-${randomBytes(12).toString("hex")}.env`);
  fs.writeFileSync(dotenvGuardFile, "", { flag: "wx" });
  dotenvGuardCreated = true;

  console.log("Creating an isolated PostgreSQL container (tmpfs storage, loopback-only port, no project database URL).");
  let createOutput;
  try {
    createOutput = docker([
    "create", "--name", containerName,
    "--label", `${OWNED_LABEL}=true`,
    "--label", `${OWNER_LABEL}=${ownerToken}`,
    "--publish", "127.0.0.1::5432",
    "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m",
    "--shm-size", "128m",
    "--env", "POSTGRES_DB",
    "--env", "POSTGRES_USER",
    "--env", "POSTGRES_PASSWORD",
    "postgres:16-alpine",
  ], {
    timeout: 3 * 60_000,
    env: safeChildEnvironment({ POSTGRES_DB: dbName, POSTGRES_USER: dbUser, POSTGRES_PASSWORD: dbPassword }),
  });
  } catch (error) {
    // A timeout or lost CLI response can happen after the daemon created the
    // resource. Adopt only an exact-name match carrying this run's random owner
    // token, then cleanup will still use its immutable ID.
    try { adoptPartiallyCreatedContainerIfOwned(); } catch (adoptionError) {
      console.error(`Partial-create ownership could not be established: ${adoptionError.message}`);
    }
    throw error;
  }
  const returnedId = createOutput.stdout.trim();
  if (!/^[a-f0-9]{64}$/i.test(returnedId)) {
    try { adoptPartiallyCreatedContainerIfOwned(); } catch (adoptionError) {
      console.error(`Create response was invalid and ownership could not be established: ${adoptionError.message}`);
    }
    fail("Docker create did not return one valid full container ID; refusing to start PostgreSQL.");
  }
  containerId = returnedId;
  containerCreatedByThisRun = true;

  const created = inspectContainerById(containerId);
  verifyContainerCreateConfiguration(created);
  docker(["start", containerId]);
  const started = inspectContainerById(containerId);
  const port = verifyContainerIsolation(started);
  await waitForPostgres(dbUser, dbName);

  // This value is constructed solely from this runner's newly-created test
  // container. It never reads or falls back to the caller's DATABASE_URL.
  temporaryDatabaseUrl = `postgresql://${dbUser}:${dbPassword}@127.0.0.1:${port}/${dbName}?schema=public&connection_limit=20`;
  originalDatabaseUrlWasSet = Object.hasOwn(process.env, "DATABASE_URL");
  originalDatabaseUrl = process.env.DATABASE_URL;
  // The in-process Prisma client used by the integration suite must also point
  // to this runner's generated URL; never let it observe the caller's URL.
  process.env.DATABASE_URL = temporaryDatabaseUrl;

  // Reconfirm owner, immutable ID, storage and loopback-only binding directly
  // before Prisma can run any database-changing command.
  verifyContainerIsolation(inspectContainerById(containerId));
  runPrisma(["generate", "--schema", "prisma/schema.prisma"], temporaryDatabaseUrl);
  verifyContainerIsolation(inspectContainerById(containerId));
  runPrisma(["migrate", "deploy", "--schema", "prisma/schema.prisma"], temporaryDatabaseUrl);

  const integration = await import("./test-demo-wallet-postgres.integration.mjs");
  if (process.env.DUELPLAY_SERVER_EVENTS_INTEGRATION === "1") await integration.runServerTechnicalEventsPostgresIntegration();
  else await integration.runDemoWalletPostgresIntegration();
}

async function onSignal(code) {
  interrupted = true;
  console.error("Interrupt received; cleaning up only the test-owned container.");
  await cleanup();
  process.exit(code);
}

process.once("SIGINT", () => { void onSignal(130); });
process.once("SIGTERM", () => { void onSignal(143); });

try {
  await main();
  console.log(process.env.DUELPLAY_SERVER_EVENTS_INTEGRATION === "1" ? "All server technical-event PostgreSQL integration scenarios completed." : "All DEMO wallet PostgreSQL integration scenarios completed.");
} catch (error) {
  console.error(`DEMO wallet integration setup/test failed: ${error?.message ?? "unknown error"}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  if (originalDatabaseUrlWasSet) process.env.DATABASE_URL = originalDatabaseUrl;
  else delete process.env.DATABASE_URL;
}
