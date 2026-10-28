# DuelPlay — login reward frames (days 7, 15, 30)

## Changes
- Added `lib/login-reward-frames.ts` as the canonical catalog for the existing reward slugs:
  - Day 7: `frame-neon-pulse` — Неоновый импульс — 75 DEMO credits.
  - Day 15: `frame-electric-storm` — Электрический шторм — 100 DEMO credits.
  - Day 30: `frame-inferno-crown` — Inferno Crown — 1,000 DEMO credits.
- Added original transparent SVG frame art and connected each cosmetic item's `imageUrl` to the corresponding asset.
- Made claim issuance repair/create the required active `FRAME` item and grant ownership through the existing unique `(userId, itemId)` `CosmeticPurchase` key in the same `withDemoTransaction` transaction as the existing claim/DEMO ledger operations.
- Repeat requests reuse the existing ledger idempotency key. If a historical claim has a missing/null cosmetic slug, the canonical day definition supplies it during recovery. If a frame was missed by an older implementation, the existing-claim path backfills ownership without crediting DEMO balance a second time.
- The login reward API and existing frame inventory/profile APIs idempotently repair the three system catalog items. This repairs image paths and source metadata for already-owned frames without deleting or recreating ownership or changing equipped-frame IDs.
- Added localized day 7/15/30 previews and descriptions in RU, UA, EN, and PL on `/login-rewards`.
- Added `scripts/test-login-reward-frame-integration.mjs` and `npm run test:login-reward-frames`.
- Updated seed synchronization for the three frame catalog items. Existing reward calendar entries, amounts, claim dates, cycles, and login streak/history are not rewritten by this change.

## Database / deployment
- No Prisma schema change and no new migration are required.
- No production database was accessed and no migration was applied.
- After deploying code and SVG files, an authenticated visit to `/login-rewards`, `/inventory`, or the profile API idempotently repairs the three system cosmetic catalog records. This does not grant unearned frame ownership; ownership is granted only by a matching login reward claim/recovery.
- Run the existing seed only if your deployment workflow normally does so; it is not required for the new runtime repair path.

## Checks performed
- `npm run test:login-reward-frames`: PASS. The new test uses an in-memory fake of Prisma's unique upsert methods, so it is a deterministic unit/source-contract check, not a PostgreSQL integration test. The existing 30-day reward test also passed.
- `node scripts/test-login-rewards-claim.mjs`: PASS.
- `node scripts/test-email-steam-profile-linking.mjs`: PASS (22 assertions).
- `node scripts/test-level-frame-collection.mjs`: PASS.
- `node scripts/test-profile-ui-regressions.mjs`: PASS (7/7).
- TypeScript `transpileModule` syntax/transpile checks on edited TS/TSX files: PASS; all three new SVGs and all SVG assets in `public/images/frames` parsed as XML.
- `node --experimental-strip-types scripts/test-profile-completion.mjs`: FAILS in the supplied baseline: its test expects four profile-completion tasks, while the unchanged current implementation exposes five. Neither that implementation nor its test was changed here.
- `npx prisma validate`, `npx prisma generate`, full `tsc --noEmit`, and `npm run build`: NOT COMPLETED. The dependency install could not finish because npm registry access failed with DNS error `EAI_AGAIN`; Prisma/Next CLI executables were therefore unavailable. `npm run build` stopped at `prisma: not found`.
- No PostgreSQL integration test was run. The in-memory helper test is explicitly not represented as one.
