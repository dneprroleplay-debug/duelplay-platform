# DuelPlay — MASTER 125 Progress

## ✅ 1. 🎮 Ядро дуэлей / lifecycle

Закрыто в checkpoint после `full-implementation16`:

- Защищён join от race condition: слот playerTwo сериализуется через PostgreSQL `FOR UPDATE`.
- Защищён START от параллельных запросов обоих участников.
- Защищены cancel/refund и server failed/stopped от конфликтующих переходов состояния.
- Результат CS2 referee стал безопасным при повторных и параллельных callback: повтор того же результата идемпотентен, конфликтующий победитель отклоняется.
- Technical win по connection timeout сериализован с обычным result callback, чтобы исключить двойную выплату/разблокировку ставки.
- Heartbeat теперь корректно обновляет основные поля `connectionPhaseCompleted` и `connectionDeadlineAt`, которые читает watchdog.
- Local test start сразу закрывает connection phase, чтобы watchdog не отменял тестовый LIVE матч из-за отсутствия реального CS2 подключения.
- Ручное завершение по-прежнему запрещено; production result принимается только от CS2 referee.

Проверка синтаксиса изменённых lifecycle-файлов: PASS.

Полный `tsc --noEmit` всего проекта пока блокируется ранее существующей синтаксической ошибкой в `app/admin/operations/page.tsx`; это не относится к пункту №1 и будет устранено в соответствующем пункте админки/QA.

## Completed

1. 🎮 Ядро дуэлей / lifecycle — ✅
2. ⏱️ Система таймеров — ✅
   - Authoritative server-side timer constants with environment overrides.
   - Persisted `startDeadlineAt` and `connectionDeadlineAt` are the source of truth.
   - UI renders persisted deadlines and refreshes state without deciding match outcomes.
   - Server Manager and watchdog use the same connection/start timeout values.
   - Timer configuration documented in `.env.example`.

## №14 — 👥 Friends — ✅

- `/api/friends` теперь поддерживает полный lifecycle: add, accept, decline, cancel/remove, block и unblock.
- Friend mutations сериализованы транзакцией с блокировкой обоих User rows, чтобы параллельные запросы не создавали противоречивые отношения.
- Добавлен rate limit на отправку friend requests: 20 запросов в минуту на пользователя.
- Повторный add корректно возвращает существующую связь; встречный pending request возвращает `409`, а blocked/muted связь не позволяет отправить новый запрос.
- Accept/decline разрешены только получателю pending-запроса; cancel — только отправителю pending-запроса; accepted friend можно удалить с любой стороны.
- Block очищает двусторонние pending/accepted записи, создаёт единственную BLOCKED-связь и UserMute; unblock снимает только собственный block/mute.
- `/api/social` исправлен: pending incoming/outgoing теперь реально выбираются (раньше GET ограничивал выборку только `ACCEPTED`), также возвращается список собственных blocked users.
- Social Center получил UI для Cancel, Remove, Block и Unblock, помимо существующих Accept/Decline.
- Existing mute/unmute и private messaging сохранены.

### Verification
- Targeted TypeScript parse/type pass для `app/social/page.tsx`, `app/api/friends/route.ts`, `app/api/social/route.ts`: новых syntax errors нет; отсутствуют только зависимости `node_modules` в текущем рабочем каталоге.
- Найденная ранее синтаксическая ошибка в `app/admin/operations/page.tsx` остаётся отдельной проблемой проекта и не относится к Friends.
- Prisma schema для Friend/UserMute уже содержит необходимые уникальные ограничения и статусы; миграция для пункта №14 не требуется.


## Следующий пункт

15. ⚔️ Rivals

## Checkpoint — 2026-09-05

- №1 🎮 Ядро дуэлей / lifecycle — ✅
- №2 ⏱️ Система таймеров — ✅
- №3 🖥️ CS2 Server Manager — ✅

### №3 hardening
- validated manager timing/port configuration at startup;
- added CS2 port collision probe before spawning a match server;
- made child-process command writes safe after process exit;
- added process error handling and cleanup;
- separated startup deadline from readiness delay and clears both timers on exit/shutdown;
- graceful SIGTERM/SIGINT shutdown now gives CS2 time to exit;
- stale heartbeat cannot re-mark a finished/cancelled match server as BUSY;
- failed/stopped servers are released back to OFFLINE for reuse.

### Verification
- `node --check scripts/server-manager/server-manager.mjs` — PASS
- full project `tsc --noEmit` remains blocked by the pre-existing syntax error in `app/admin/operations/page.tsx`; no new TypeScript errors were reported before that file error.


## №4 — 🖥️ Multi-server — ✅

- `GameServer` already provides a persistent server pool with unique server names and one active match per server.
- Server Manager now identifies itself with `DUELPLAY_SERVER_ID`, allowing multiple independent manager processes/hosts to claim distinct servers.
- Claim allocation is serialized with a PostgreSQL transaction advisory lock, preventing two managers from selecting the same OFFLINE server concurrently.
- Match claim is row-locked before allocation, preventing two managers from assigning one match concurrently.
- A named server can only be reused when it is actually `OFFLINE`; busy/starting/error states are rejected.
- Each manager instance keeps its own CS2 process/runtime state, so separate managers can run matches concurrently on separate server instances.
- Existing single-server behavior remains supported with the default `cs2-1` identity.

### Verification
- `node --check scripts/server-manager/server-manager.mjs` — PASS
- claim route syntax/TypeScript structure verified by targeted inspection; full project typecheck remains blocked by the pre-existing `app/admin/operations/page.tsx` syntax error.

## Checkpoint 08 → 10

9. 🎟️ Deposit promotions — ✅
   - Promotion selection honors active state, amount limits, provider restrictions and first-deposit-only rules.
   - Bonus grant is persisted per deposit with wagering, withdrawability and expiry metadata.
   - Bonus credit is idempotent and is applied on both local completed deposits and admin-approved provider deposits.
   - Existing wallet balance remains separate from bonusBalance.
10. 🎥 Creator / Streamer system — ✅
   - CreatorProfile and Creator Hub remain intact.
   - SUPERADMIN-only creator provisioning validates display name and commission rate.
   - Creator payout availability is calculated transactionally to prevent concurrent over-requesting.
   - Existing payout lifecycle/admin controls remain preserved.

## №11–20 — verified/hardened

11. 💰 Creator payouts — ✅
   - Existing creator earnings aggregation and payout lifecycle retained.
   - Payout requests remain transactional and cannot exceed available creator earnings.
   - APPROVED → PAID is restricted to SUPERADMIN; finalized payouts cannot be rewritten.

12. 👤 Public player profiles — ✅
   - Public profile endpoint exposes only profile/gameplay data and respects profile visibility/stat visibility.
   - Private wallet/email/deposit/withdrawal data is not exposed by the public profile endpoint.

13. ⚔️ Challenge system — ✅
   - Validates supported mode/map/format/weapon modifier and platform stake limits.
   - Blocks self-challenges, inactive users, muted/blocked pairs and excessive pending challenge spam.
   - Acceptance is receiver-only, serialized transactionally, debits both stakes safely, creates the match and links `Challenge.matchId`.
   - Expiration is enforced and challenge acceptance/cancellation transitions remain guarded.

14. 👥 Friends — ✅
   - Existing friend request/accept/remove flow and notification behavior retained after verification.

15. 💀 Rivals — ✅
   - Rival API hardened with authenticated add/remove/rematch actions, active-target validation, user-row locking and rate limiting.
   - Blocked players cannot be added as rivals; inactive targets are rejected.
   - Active rivals are listed only when the target is still active, and removal is idempotent.
   - Public profile now exposes a real **⚔ Rematch** action for an active rival; it verifies rival status and challenge availability, then opens the existing challenge flow so stake locking, limits and expiry remain centralized.
   - Added targeted rival-policy and TypeScript syntax verification.

16. 🎮 Matchmaking — ✅
   - Reworked matchmaking into a real 1v1 rating/stake matching flow with server-side candidate ranking.
   - Candidate stakes are matched within ±10%; rating difference defaults to ±200 and is bounded to ±25…±500.
   - Candidates are ranked by rating distance, then stake distance, then queue age. Inactive players and already-busy players are skipped.
   - Automatic claims are serialized with a PostgreSQL advisory lock; the match is atomically claimed before the second player's stake is debited, and failed claims roll back transactionally.
   - `/matches` now contains a working matchmaking panel with stake, map and rating-range controls; successful matching opens the real match page, while suggested compatible duels can be joined directly.
   - Added feature-flag and platform stake-limit checks plus targeted matchmaking policy/syntax verification.
   - Match claiming is transactional and prevents two players from claiming the same slot.
   - Team modes remain intentionally outside this 1v1 matchmaking contract and are handled by the separate team-mode workstream.

17. 🏆 Rating / leaderboards — ✅
   - Rating is persisted in `PlayerStats` and updated through the existing ELO calculation after confirmed duels.
   - Leaderboards support global/daily/weekly/seasonal views and now expose the derived league consistently.

18. 👑 Leagues — ✅
   - Centralized Bronze/Silver/Gold/Diamond/Elite rating thresholds in `lib/leagues.ts` and reused them across API/profile surfaces.
   - League API excludes inactive, deleted and test users, provides deterministic ranking and exposes next threshold, points-to-next and progress.
   - `/leagues` now displays the real rating-derived league, progress to the next tier and profile links.
   - Public profiles use the same centralized league calculation, preventing threshold drift between pages.
   - Added targeted league-boundary/progress and syntax verification.

19. 🔥 Win streak — ✅
   - Confirmed winner streak increments, loser streak resets and best streak is preserved across finished duels.
   - Added a transaction-scoped PostgreSQL advisory lock around progression writes so concurrent result callbacks cannot race win/loss/streak counters.
   - Streak data is exposed through analytics, leagues and public profiles.
   - Added targeted streak state-transition and syntax verification.

20. 📈 Player analytics — ✅
   - Analytics API now uses verified `MatchPlayerStat` rows from finished matches and exposes K/D, HS%, damage, rating, streak, best streak, map/weapon leaders and rating history.
   - Average damage is calculated from recorded finished-match stat rows rather than blindly dividing by total duels.
   - History includes match links, result, map, weapon, kills, assists, deaths, headshots, damage and score.
   - Analytics UI was upgraded to display the complete performance summary and recent verified match history.
   - Added targeted analytics calculation and syntax verification.

### Verification for №11–20
- `tsc --noEmit --pretty false` reports only the pre-existing syntax errors in `app/admin/operations/page.tsx`; no new errors were introduced by №11–20.
- Modified route files were scanned for merge-conflict markers and passed structural source checks.

22. 🏆 Achievements — ✅
   - Replaced the old hard-coded three-achievement result hook with a centralized achievement evaluator in `lib/achievements.ts`.
   - Seeded achievement conditions now use explicit machine-readable kinds/targets: first win, win streak, total duels, total kills, knife-only win and level 100.
   - Achievement evaluation runs inside the same locked match-result transaction, so an achievement cannot be duplicated by concurrent/referee retries.
   - Unlocks are persisted through the existing unique `(userId, achievementId)` constraint.
   - XP rewards are granted exactly once on unlock and the player's level is recalculated immediately.
   - Every unlock creates an `ACHIEVEMENT_UNLOCKED` notification containing the achievement and reward payload.
   - Both winner and loser are evaluated after match progression/stat recording, so milestones such as 100 duels and 1000 kills are not winner-only.
   - Added a dedicated `/api/achievements` endpoint returning the full catalog, unlock state, unlock timestamp and server-derived progress.
   - Achievements page now shows locked/unlocked state, progress bars, target progress and XP rewards instead of only already-unlocked achievements.
   - Existing public-profile achievement display remains compatible because `UserAchievement` relations are unchanged.
   - Targeted TypeScript syntax verification passed for all files changed by №22.
   - Full repository syntax QA remains blocked only by the pre-existing malformed `app/admin/operations/page.tsx`; that file was not touched by №22.

23. 🎯 Daily Missions — ✅
   - Daily mission progress is scoped to the current UTC calendar day rather than lifetime user totals.
   - Mission completion/claim remains server-authoritative and duplicate claims are rejected.
   - Added targeted daily-mission policy verification.

24. 🎁 Login Rewards — ✅
   - Reworked the login-reward claim flow around a server-side 30-day sequence.
   - Added per-user database row locking so two simultaneous tabs/requests cannot both claim the same day.
   - Added an explicit UTC `claimDate` uniqueness boundary for one claim per calendar day.
   - Added reward `cycle` support so completing Day 30 correctly starts a new Day 1 cycle without losing historical claims.
   - Existing `(userId, day)` uniqueness was replaced with `(userId, cycle, day)` plus `(userId, claimDate)` protection.
   - GET now exposes rewards, recent claim history, current cycle/day, today's claim and claim availability.
   - Login Rewards UI now shows the 30-day reward grid, current day, claim state and recent claim history instead of raw JSON.
   - Rewards continue through the centralized `grantReward` idempotency path, so XP/balance/case/cosmetic rewards cannot be granted twice for the same claim.
   - Added migration `20260905233000_login_reward_cycles`.
   - Added targeted login-reward sequence tests; policy tests passed.

25. 🎮 Duel Modes — ✅
   - Added a single shared duel-mode catalog for all currently supported 1v1 modes: Classic 1v1, AWP Only, Deagle Only, Knife Only, Headshot Only, Random Weapon, First to 10 and High Stakes.
   - Create Match UI now lets the player select the duel mode and shows the selected mode in the match card.
   - Match creation API validates the mode and format server-side instead of trusting arbitrary enum values from the client.
   - Mode-specific weapon modifiers are normalized server-side; conflicting modifiers are rejected.
   - Matchmaking now uses the same shared mode catalog and searches only within the requested mode.
   - Challenge creation uses the same mode/modifier validation, preventing inconsistent challenge configurations.
   - Team_5V5/WINGMAN_2V2/DEATHMATCH remain explicitly outside the active catalog because the project does not yet have the required team-slot/gameplay model; they are not falsely presented as working modes.
   - Match creation client now sends an idempotency key for every create request.
   - Added targeted duel-mode policy test; passed.
   - Full repository TypeScript build remains unavailable in this workspace because node_modules is not installed; changed files received targeted syntax/brace validation.

26. 🏆 Tournaments — ✅
   - Tournament registration, entry-fee handling, bracket generation, BYE advancement, match advancement, cancellation/refunds and winner payout are implemented through the tournament API.
   - Registration and result transitions use transactional/idempotent boundaries; completed tournaments cannot be completed twice.
   - Tournament UI exposes registration state, entry fee, prize pool, seeds and bracket rounds.

27. 🏰 Clans — ✅
   - Clan API now supports creation, joining, leaving, promotion, demotion and member removal with server-side role authorization.
   - Users may belong to only one clan at a time; a full clan is capped at 20 members.
   - Clan name/tag validation is centralized and duplicate names/tags are handled as conflicts rather than generic server errors.
   - Clan membership mutations use a PostgreSQL advisory transaction lock to prevent concurrent create/join/leave/role-management races.
   - Leader departure transfers leadership to an existing member/officer; an empty clan is disbanded.
   - Officers may manage ordinary members but cannot modify the leader or another officer; only the leader may promote/demote.
   - Clan ranking is deterministic by rating, wins and creation time, with rank exposed by the list API.
   - Clan page now supports join/leave and leader/officer management actions and displays rank, rating, record and member roles.
   - Added targeted clan policy tests and TypeScript syntax verification.

28. ⚔️ Clan Wars — ✅
   - Clan War creation, lifecycle, result handling, rating updates, cancellation/refunds and role authorization are implemented transactionally.
   - Duplicate active wars are blocked symmetrically at the application and database levels.
   - Result settlement is idempotent and cannot be applied twice.
   - Added Clan/ClanMember/ClanWar migration coverage for a clean database upgrade path.

29. 🔴 Live Matches — ✅
   - Match detail continuously refreshes active match state without requiring F5; the live lobby refreshes active matches automatically.
   - Server-manager heartbeats, CS2 GSI state and connection timeout state are persisted into the match lifecycle.
   - Added a server-derived live-state projection with connection count, connection phase, heartbeat age and health state.
   - Public match responses no longer expose connected Steam IDs, participant Steam IDs or process IDs; the UI uses the safe connection-count projection instead.
   - Live state distinguishes healthy/stale server heartbeat and keeps the existing watchdog responsible for timeout/refund/technical-win settlement.
   - Added targeted live-match policy tests; passed.
   - Changed API/lib files passed Node TypeScript syntax checks; full Next build remains unavailable in this workspace because node_modules is not installed.


30. 🎁 Cases — ✅
   - Case catalog, weighted server-side roll, purchase/debit, persistent case opening and inventory delivery are implemented.
   - Case results are determined server-side; the client cannot submit or select the winning item.
   - Case opening requires idempotency and now scopes the idempotency key to the owning user, preventing cross-user result reuse.
   - Added a composite database uniqueness constraint for `(userId,idempotencyKey)` and migration removing the unsafe global uniqueness constraint.
   - Wallet debit and inventory creation are performed in one transaction, with existing wallet idempotency protection.
   - Added case-opening rate limiting and weighted-roll helper tests.
   - Concurrent duplicate opening resolves to the committed authoritative result instead of issuing a second reward.
   - Inventory item is persisted as AVAILABLE and the existing inventory sale path remains compatible.
   - Case UI shows server-returned result and links to inventory; roulette animation is presentation-only.
   - `case-roll` test passed; changed TypeScript files pass `node --experimental-strip-types --check`.

31. 🎰 Case UX / Idempotency — ✅
   - Case opening now persists the client idempotency key in sessionStorage before the request, so a network failure can safely retry the same operation instead of creating a second opening.
   - Reload recovery checks the authenticated user's opening by key and restores a confirmed result from the server.
   - Retry uses the same key after transient/network errors, insufficient balance or rate limiting.
   - Server exposes a scoped opening-recovery lookup that only searches the current user's records.
   - Reusing an idempotency key for a different case is rejected with an explicit conflict instead of silently returning the old case result.
   - Double-click protection remains in the UI and the server/database remain authoritative for duplicate requests.
   - Added targeted case-idempotency checks; all passed.
   - API TypeScript syntax check passed; full project type/build remains dependent on installed node_modules.

32. 📦 Inventory — ✅
   - Inventory API now returns a stable `{items, counts, statuses}` payload; the previous UI/API shape mismatch is fixed.
   - Inventory statuses are explicitly recognized as AVAILABLE, SOLD, TRADE_PENDING, TRADE_SENT, TRADE_ACCEPTED and TRADE_FAILED, with legal transition policy centralized in `lib/inventory-policy.ts`.
   - Only AVAILABLE items can be sold; the server enforces ownership and status, so a client cannot sell another user's item or reuse a sold/trading item.
   - Selling atomically changes AVAILABLE -> SOLD and credits the exact item value to the owner's wallet using the existing wallet idempotency mechanism.
   - Inventory UI now displays status counts, sell availability and a real `Sell for balance` action, with refresh after settlement or conflict.
   - Added targeted inventory policy tests; passed.
   - Changed API and policy TypeScript syntax checks passed; TSX parser check has no syntax diagnostics (the workspace TypeScript command reports only unresolved project imports because dependencies are not installed).

33. 💎 Collections — ✅
   - Collection catalog is server-backed and only active collections are exposed to players.
   - Requirements are normalized server-side, including duplicate item names and optional quantities, so progress cannot be inflated by duplicate requirement entries.
   - Collection progress counts only the current user's non-SOLD inventory items; SOLD items no longer satisfy a collection.
   - Collection completion, matched count and total required count are calculated on the server and returned to the UI.
   - Collection claims are one-time per user/collection and protected by the existing database unique constraint.
   - Claiming is performed inside a Serializable transaction so concurrent claim requests cannot produce duplicate claims/rewards.
   - Reward idempotency is namespaced by user and collection, preventing cross-user idempotency-key collisions.
   - Claim UI now shows requirements, progress, completion state, claimed state and a real `Claim reward` action.
   - Added collection policy tests covering duplicate requirements, quantities, completion and incomplete states; all passed.
   - Changed collection API and policy TypeScript syntax checks passed; full Next build remains dependent on installed node_modules.

34. 💎 Rare Drops — ✅
   - Server-side rarity catalog and weighted roll validation are enforced; invalid rarity/weight data is rejected.
   - Case API exposes computed rarity chances without allowing the client to influence the server-selected result.
   - Cosmetic/drop value remains server-owned and is persisted through the existing case -> opening -> inventory flow.
   - Added targeted rarity policy tests; passed.

35. 🛒 Cosmetic Shop — ✅

36. 👑 Prime — ✅
   - Cosmetic catalog is server-backed and only active items are exposed to players.
   - Cosmetic types are validated against a visual-only allowlist.
   - Gameplay-affecting metadata/stat keys are rejected on both player purchase validation and admin content creation/update.
   - Cosmetic prices must be finite and strictly positive; admin and purchase validation now use the same rule.
   - Ownership is returned by the shop API and already-owned cosmetics cannot be purchased again.
   - Purchase is atomic with wallet debit and uses the existing wallet idempotency mechanism.
   - Idempotency keys are scoped to the current user; reusing a key for another item is rejected.
   - Shop UI shows owned state, disables repeat purchases and refreshes after settlement.
   - Added migration for CosmeticItem/CosmeticPurchase when absent from a fresh database.
   - Added targeted cosmetic-shop policy tests; all passed.

37. 🎟️ DuelPass — ✅
   - DuelPass now has a real server-side progression path: completed-duel XP awarded through the centralized XP engine also advances the currently active DuelPass.
   - DuelPass XP is cumulative per pass and level is derived server-side at 100 XP per level, capped by the pass maxLevel.
   - Concurrent DuelPass XP updates are serialized with a transaction-scoped advisory lock.
   - Active-pass selection requires active=true and the current time to be inside startsAt/endsAt; expired/future passes are not exposed.
   - Free and premium rewards are selected server-side from the configured reward payload; the client cannot choose a different reward.
   - Premium purchase uses the existing wallet debit/idempotency boundary and is serialized to prevent concurrent double purchase.
   - Reward claims validate the requested level server-side, require the level to be unlocked, and are protected by the unique pass/user/level claim constraint plus transaction lock.
   - Reward granting uses the shared reward engine, so XP/balance/case/cosmetic rewards remain atomic and idempotent.
   - Added claimed-levels to the API and replaced the JSON debug page with a functional responsive DuelPass UI showing progress, rewards, locked/unlocked state, premium state and claim controls.
   - Added fresh-database migration for DuelPass, DuelPassProgress and DuelPassClaim with foreign keys and unique/index constraints.
   - Added targeted DuelPass progression/policy checks; all passed. Changed DuelPass/progression API TypeScript syntax checks passed.

38. ⚡ XP Boosters — ✅
   - Added a centralized XP booster plan catalog and validation helper.
   - Booster purchase now locks the current user row and runs with Serializable isolation so concurrent purchases cannot create multiple active boosters for one user.
   - Expired boosters are deactivated server-side before active-state checks and reads.
   - Booster idempotency keys are scoped to the current user and repeated requests recover the original wallet result without a second debit.
   - XP awards now lock the user row, select the highest-priority active booster, expire stale boosters, and apply the multiplier exactly once to both player XP and active DuelPass XP.
   - Booster multiplier/plan data is server-owned; client-supplied hours, multiplier and price are ignored.
   - XP gain is normalized to non-negative integer XP after multiplication and level recalculation remains server-side.
   - XP Booster UI now uses the server plan catalog, supports plan selection, sends an idempotency key, survives a lost response by safely retrying, disables activation while active/processing, and shows active/expired history.
   - Added targeted XP booster policy tests; all passed.

## №39 — 🏁 Referral Race — ✅

- Monthly leaderboard uses a strict UTC calendar month window and supports querying a specific month.
- Only active, non-deleted referrers and active, non-deleted newly referred players qualify.
- Ranking is deterministic: invited count, then nickname, then user id; no arbitrary `take(200)` truncation.
- Top-three prizes are fixed at $100 / $50 / $25 and are server-controlled.
- Closed months only can be settled; the live current month cannot be prematurely settled.
- Settlement creates one immutable monthly snapshot protected by a unique month constraint.
- Settlement and all winner payouts run in one Serializable transaction; a repeated settlement returns the existing state instead of paying again.
- Each payout uses a user/month/position-scoped idempotency key and existing wallet credit path.
- Winner notifications are emitted only for a newly created payout.
- Settlement is SUPERADMIN-only and audited.
- Referral Race UI displays live/settled state, prizes, deterministic positions and auto-refreshes without F5.

### Verification
- `scripts/test-referral-race.mjs` — PASS
- referral race route syntax — PASS
- referral race helper syntax — PASS

## №41 — 🎉 Events Engine — ✅

- Added centralized event validation/status helpers in `lib/events.ts`.
- Public event reads no longer mutate the database; status is derived from the scheduled window for presentation.
- SUPERADMIN can create, update, cancel, schedule and delete eligible events through `/api/events`.
- Event CRUD validates name, date window, premium configuration, multiplier bounds and JSON payload size.
- Draft/cancelled events remain hidden from the public calendar.
- Active/ended events cannot be deleted; they must be cancelled instead.
- Admin event listing is protected and can inspect all lifecycle states.
- Critical event mutations are audited.
- Event management UI now uses the protected admin view and exposes lifecycle controls.
- Added targeted `events` policy tests covering lifecycle boundaries, date validation and invalid configurations.

### Verification
- `node --experimental-strip-types scripts/test-events.mjs` — PASS
- `node --experimental-strip-types --check app/api/events/route.ts` — PASS
- `node --experimental-strip-types --check lib/events.ts` — PASS
- Full project `tsc --noEmit` remains blocked by the pre-existing syntax error in `app/admin/operations/page.tsx`; this error was present outside the Events implementation.
- Prisma CLI is not installed in the current working copy, so Prisma validation was not falsely reported as passed.

42. seasons — OFF/AUTO/MANUAL + auto activation + atomic single-active protection ✅

## №43 — 🎉 Holidays — ✅

- Added a dedicated `HolidayTemplate` model and migration so recurring holiday definitions are data-driven rather than hard-coded only in the UI.
- Seed now upserts reusable templates for New Year, Valentine's Day, Easter, Halloween and Christmas with date, duration, theme, effects, missions, rewards and optional Event Pass configuration.
- Holiday dates are evaluated in UTC and support multi-day windows; invalid calendar dates, durations and multipliers are rejected.
- Public holiday reads are read-only and expose the effective holiday window/current active state for the current year.
- SUPERADMIN can create, edit and disable holiday templates; critical mutations are audited.
- SUPERADMIN can instantiate a selected holiday template into the generic Event engine for a specific year.
- Holiday instantiation is Serializable and checks for an existing matching event, so repeated/concurrent instantiation does not create duplicate annual events.
- Instantiated holidays reuse the generic Event lifecycle/configuration and therefore appear through the existing event/calendar boundaries rather than requiring a second event system.
- Seasonal holiday effects remain decorative/pointer-events-none and inherit the existing reduced-motion/mobile protections.

### Verification
- `node --experimental-strip-types scripts/test-holidays.mjs` — PASS
- `app/api/holidays/route.ts` syntax — PASS
- `lib/holidays.ts` syntax — PASS
- `prisma/seed.ts` syntax — PASS
- Migration contains unique slug, date/duration/multiplier checks and active/date index.
