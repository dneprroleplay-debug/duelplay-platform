import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

function enumMap() {
  const out = new Map();
  const re = /enum\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(schema))) {
    const values = m[2].split("\n").map(x => x.trim()).filter(x => x && !x.startsWith("//") && /^[A-Z0-9_]+$/.test(x));
    out.set(m[1], values);
  }
  return out;
}

async function typeExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_type WHERE typname = '${name.replaceAll("'", "''")}' LIMIT 1`
  );
  return rows.length > 0;
}

async function columnInfo(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='${column}' LIMIT 1`
  );
  return rows[0]?.data_type ?? null;
}

async function ensureEnumValues(type, values) {
  if (!(await typeExists(type))) return;
  for (const value of values) {
    const t = type.replaceAll('"', '""');
    const v = value.replaceAll("'", "''");
    await prisma.$executeRawUnsafe(`ALTER TYPE "${t}" ADD VALUE IF NOT EXISTS '${v}'`);
  }
}

async function normalizeUuidColumn(table, column) {
  const dataType = await columnInfo(table, column);
  if (!dataType || dataType === "uuid") return;
  if (!["text", "character varying", "character"].includes(dataType)) return;
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "${table}"
    ALTER COLUMN "${column}" TYPE uuid
    USING CASE
      WHEN "${column}" IS NULL OR btrim("${column}") = '' THEN NULL
      WHEN "${column}" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN "${column}"::uuid
      ELSE NULL
    END
  `);
  console.log(`Converted ${table}.${column} to UUID`);
}

try {
  for (const [type, values] of enumMap()) await ensureEnumValues(type, values);

  // v29 databases stored these tournament participant references as text.
  // The current schema correctly relates them to User.id (UUID). Valid UUIDs
  // are converted; malformed legacy values are nulled instead of aborting the
  // whole sync before Prisma can add the foreign keys.
  for (const column of ["playerOneId", "playerTwoId", "winnerId"]) {
    await normalizeUuidColumn("TournamentMatch", column);
  }

  console.log("DuelPlay database compatibility preparation: PASS");
} finally {
  await prisma.$disconnect();
}
