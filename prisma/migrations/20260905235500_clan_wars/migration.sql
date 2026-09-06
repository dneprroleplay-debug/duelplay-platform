-- Persist clan and clan-war models for databases created from migrations only.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClanMemberRole') THEN
    CREATE TYPE "ClanMemberRole" AS ENUM ('LEADER', 'OFFICER', 'MEMBER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Clan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "logoUrl" TEXT,
  "creatorId" UUID NOT NULL,
  "rating" INTEGER NOT NULL DEFAULT 1000,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Clan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Clan_name_key" ON "Clan"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Clan_tag_key" ON "Clan"("tag");
CREATE INDEX IF NOT EXISTS "Clan_rating_wins_createdAt_idx" ON "Clan"("rating", "wins", "createdAt");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Clan_creatorId_fkey') THEN
    ALTER TABLE "Clan" ADD CONSTRAINT "Clan_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ClanMember" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "clanId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "ClanMemberRole" NOT NULL DEFAULT 'MEMBER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClanMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClanMember_clanId_userId_key" ON "ClanMember"("clanId", "userId");
CREATE INDEX IF NOT EXISTS "ClanMember_userId_idx" ON "ClanMember"("userId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClanMember_clanId_fkey') THEN
    ALTER TABLE "ClanMember" ADD CONSTRAINT "ClanMember_clanId_fkey" FOREIGN KEY ("clanId") REFERENCES "Clan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClanMember_userId_fkey') THEN
    ALTER TABLE "ClanMember" ADD CONSTRAINT "ClanMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ClanWar" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "clanOneId" UUID NOT NULL,
  "clanTwoId" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "winnerClanId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClanWar_pkey" PRIMARY KEY ("id")
);
DO $$
DECLARE
  winner_type text;
BEGIN
  SELECT data_type INTO winner_type
  FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = 'ClanWar' AND column_name = 'winnerClanId';
  IF winner_type IS NOT NULL AND winner_type <> 'uuid' THEN
    ALTER TABLE "ClanWar"
      ALTER COLUMN "winnerClanId" TYPE UUID
      USING CASE
        WHEN "winnerClanId" IS NULL OR btrim("winnerClanId") = '' THEN NULL
        WHEN "winnerClanId" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN "winnerClanId"::uuid
        ELSE NULL
      END;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "ClanWar_status_createdAt_idx" ON "ClanWar"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ClanWar_clanOneId_status_idx" ON "ClanWar"("clanOneId", "status");
CREATE INDEX IF NOT EXISTS "ClanWar_clanTwoId_status_idx" ON "ClanWar"("clanTwoId", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClanWar_clanOneId_fkey') THEN
    ALTER TABLE "ClanWar" ADD CONSTRAINT "ClanWar_clanOneId_fkey" FOREIGN KEY ("clanOneId") REFERENCES "Clan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClanWar_clanTwoId_fkey') THEN
    ALTER TABLE "ClanWar" ADD CONSTRAINT "ClanWar_clanTwoId_fkey" FOREIGN KEY ("clanTwoId") REFERENCES "Clan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClanWar_winnerClanId_fkey') THEN
    ALTER TABLE "ClanWar" ADD CONSTRAINT "ClanWar_winnerClanId_fkey" FOREIGN KEY ("winnerClanId") REFERENCES "Clan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "ClanWar_active_pair_idx"
ON "ClanWar" (LEAST("clanOneId", "clanTwoId"), GREATEST("clanOneId", "clanTwoId"))
WHERE "status" IN ('PENDING', 'ACTIVE');
