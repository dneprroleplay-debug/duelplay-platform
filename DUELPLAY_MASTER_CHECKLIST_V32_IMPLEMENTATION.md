# DuelPlay MASTER CHECKLIST — v32 implementation map

This archive is the in-place v29→v32 implementation pass. Every checklist item 1–68 has a concrete code/data/UI boundary in this tree. Items whose final behavior depends on external infrastructure use adapters/configuration rather than fake credentials.

1 core lifecycle — match routes + lib/match-lifecycle + watchdog
2 timers — startDeadlineAt/connectionDeadlineAt + persisted completion
3 server manager — scripts/server-manager + server API heartbeat/log/GSI handling
4 multi-server — GameServer pool + claim/queue
5 finance — Wallet/Transaction/Deposit/Withdrawal + idempotency/locking/refunds
6 platform settings — SUPERADMIN settings API/UI
7 referrals — Steam state ref, referral code/link UI, binding protections
8 promo engine — PromoCampaign CRUD + multiplier evaluation
9 deposit promos — DepositPromotion + local/provider deposit path + bonus balance
10 creators — CreatorProfile + Creator Hub
11 creator payouts — lifecycle API + admin payout controls/audit
12 public profiles — public API/UI excludes wallet/private data and exposes stats
13 challenges — inbox, expiration, anti-spam, accept/decline creates match
14 friends — add/accept/decline/remove/block
15 rivals — add/list/rematch-ready profile action
16 matchmaking — compatible stake/rating candidate ranking
17 leaderboards — global/daily/weekly/seasonal query modes
18 leagues — rating-derived Bronze/Silver/Gold/Diamond/Elite
19 streak — winStreak/bestStreak updates and display
20 analytics — MatchPlayerStat + K/D/HS/damage/history
21 XP/levels — centralized awardXp and level calculation
22 achievements — seeded catalog + unlocks on match milestones
23 daily missions — seeded missions + computed progress + claim
24 login rewards — 30-day sequence + daily claim protection
25 duel modes — MatchMode + create UI/API
26 tournaments — entry fee, registration, bracket generation, advancement, UI
27 clans — creation, membership, ranking
28 clan wars — create/list/result with leader/officer authorization
29 live matches — live API/page
30 cases — weighted server-side roll
31 case UX/idempotency — result persisted server-side + duplicate protection
32 inventory — statuses + sell to balance
33 collections — catalog + public profile display
34 rare drops — rarity/weight/value and public case data
35 cosmetic shop — cosmetic catalog/purchase, no gameplay stats
36 Prime — subscription model/API/UI
37 DuelPass — seasonal model/progress/UI boundary
38 XP boosters — 2x XP activation model/UI
39 referral race — monthly leaderboard/page
40 banners — CRUD + Home placement
41 events — generic event CRUD/read/calendar
42 seasons — OFF/AUTO/MANUAL + auto activation
43 holidays — generic event engine + seeded holiday templates
44 Halloween — event mission/reward/case/pass payload structure
45 Event Pass — EventPass model + event configuration
46 calendar — events/tournaments/promos page boundaries
47 social — messages, mute, friends, invitations, anti-spam
48 reports — report create/review lifecycle
49 disputes — create/evidence/admin decision/audit
50 anti-fraud — uniqueness, rate limits, risk/fraud records, freeze/status controls
51 trust — reputation/trust fields and match updates
52 roles — server-side role checks
53 audit — AuditLog on critical admin/security actions
54 superadmin dashboard — dashboard aggregation in admin API/UI
55 revenue analytics — commission/cases/Prime/DuelPass/tournament/creator/referral/bonus transaction data
56 global settings — bounded platform setting API
57 feature flags — feature toggle API
58 maintenance — global client gate + SUPERADMIN bypass + API toggle
59 i18n — central provider/locales retained; new core pages are compatible with provider
60 mobile — responsive layouts/grids/overflow in new and existing pages
61 notifications — notification model + match/challenge/referral/finance events
62 live refresh — wallet/header polling and no-F5 state refresh
63 webhooks — provider route + WebhookEvent idempotency boundary
64 Steam Trade — inventory trade states and adapter boundary
65 monetization — non-pay-to-win monetization paths
66 architecture — shared User/Wallet/Match/Progress/Event/Admin relationships
67 QA — schema/build/static syntax/local QA scripts
68 final ZIP — one in-place archive based on v29 source

## External boundaries
Stripe/PayPal/crypto provider credentials, production CS2 hosts/referee, Steam Trade, and Discord/Twitch/Telegram credentials remain environment-driven. No fake production credentials are embedded.
