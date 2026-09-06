# DuelPlay v33 database sync

`npm run db:sync` runs a compatibility preflight before `prisma db push`.

The preflight reads the current Prisma schema and adds any missing values to enum types that already exist in PostgreSQL. It also converts legacy `TournamentMatch.playerOneId`, `playerTwoId`, and `winnerId` text columns to UUID where possible so the User foreign keys can be created. Invalid legacy IDs are nulled rather than aborting the synchronization.

No `--accept-data-loss` flag is used. Prisma still asks for confirmation when its schema diff detects a potentially destructive operation.
