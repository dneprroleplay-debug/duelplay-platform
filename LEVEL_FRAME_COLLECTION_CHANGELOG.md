# DuelPlay level frame collection

## Implemented
- Added seven level reward frames for levels 10, 20, 30, 40, 50, 75, and 100.
- Added SVG assets designed as transparent avatar borders that leave the face unobstructed.
- Added `lib/level-frames.ts` to define the catalog and idempotently grant all earned frames through the existing `CosmeticItem` and `CosmeticPurchase` models.
- Integrated grants with the existing `awardXp` flow and added an inventory-read backfill for accounts that already reached level thresholds.
- Extended `/api/profile/frame` to return owned frames and locked level collection entries. Equip requests still require an existing owned `FRAME` purchase.
- Extended the existing inventory frame section with localized names, source categories, unlock levels, ownership state, and equip/remove controls in RU, UA, EN, and PL.
- Rendered equipped frame SVGs on the signed-in profile and public profile when an image asset is available.
- Excluded level reward frames from shop listings and rejected purchase attempts for them.
- Added `scripts/test-level-frame-collection.mjs` and the `npm run test:level-frame-collection` script.

## Reward sources
- `DuelPlay Complete`: profile completion.
- `frame-level-*`: level progression.
- Existing `frame-neon-pulse`, `frame-electric-storm`, and `frame-inferno-crown`: DuelPlay Hub login rewards.
- Other owned frames remain categorized as other.

## Database and deployment
- No Prisma schema change was required; the feature uses existing `CosmeticItem.metadata`, `CosmeticPurchase` unique ownership, and `User.level`.
- No new migration is required.
- Existing level thresholds are consistent with `lib/level.ts`: `level = floor(sqrt(xp / 100))`, capped at 100. Corresponding XP thresholds are 10,000; 40,000; 90,000; 160,000; 250,000; 562,500; and 1,000,000.
- Deploy the code and public SVG assets together. On the next inventory frame API request, the level catalog is idempotently upserted and all earned level frames are backfilled. XP progression grants newly earned frames in the same transaction as the XP update.

## Checks
- `node scripts/test-level-frame-collection.mjs`: PASS.
- `package.json` JSON parse: PASS.
- `npx prisma validate`, `npx prisma generate`, `npx tsc --noEmit`, and production build: NOT RUN TO COMPLETION. The archive did not include installed dependencies; `npm ci --no-audit --no-fund` timed out in this environment and left no usable Prisma/TypeScript CLI binaries.
- No production database was accessed. No CS2 updates, protected plugin edits, migrations, commits, pushes, or deployments were performed.

## Frame glow animation update (2026-10-28)
- Added restrained animated glow styling for the three login-reward frames (days 7, 15, and 30) and all seven level frames.
- Applied the same slug-based styling to login-reward previews, inventory cards, the owner's profile overlay, and public profile overlays.
- Added `prefers-reduced-motion` support to disable decorative animation for users who request reduced motion.
- Added `npm run test:frame-animations` to verify every frame selector, SVG asset, and rendering integration. This is a source-contract test, not a browser/production database integration test.
