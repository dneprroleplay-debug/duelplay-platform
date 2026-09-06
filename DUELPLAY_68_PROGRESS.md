# DuelPlay — Master Checklist engineering progress

This file records implementation state; a checkbox is only marked complete after the corresponding behavior is implemented and QA-verified.

## Current pass
- 30 Cases: server-side weighted roll, idempotency, wallet debit, inventory award — implemented.
- 31 Case roulette: client animation consumes the server-selected result — implemented.
- 32 Inventory statuses/sale: AVAILABLE -> SOLD guarded transition and atomic wallet credit — hardened.
- 33 Collections: progress calculation from owned inventory and idempotent reward claim — implemented.
- 34 Rare drops: rarity/weight data and server-side selection are in place — implemented.
- 35 Cosmetic shop: wallet debit is server-side and purchase ownership is unique — hardened.
- 36 Prime: fixed server-side plans, renewal extension, idempotent payment — hardened.
- 37 DuelPass: premium purchase and level reward claim are server-authoritative — implemented.
- 38 XP boosters: fixed server-side plans, one active booster, idempotent purchase — hardened.
- Event Pass: premium purchase and reward claims are now exposed through /api/event-pass.

## Verification
- TypeScript/TSX parser scan: 0 syntax errors.
- Full production build was already verified clean on the v38/v43 base before this pass; this pass is code/schema changes and must receive the next local `npm run build` before final QA sign-off.

## Pass 39-66 hardening
- 39 Referral Race: leaderboard includes referral earnings and monthly invited/active counts; prize positions are deterministic.
- 40 Promo banners: active-window filtering and admin creation are wired; calendar exposes scheduled banners.
- 41 Events: automatic SCHEDULED -> ACTIVE -> ENDED transitions on reads plus audited admin create/update.
- 42 Seasons: OFF/AUTO/MANUAL selection and active-season exclusivity are enforced by the season API.
- 43 Holiday/event themes: seasonal atmosphere consumes active season theme/effects.
- 44 Halloween-style seasonal effects are supported through the season effects/particle configuration.
- 45 Event Pass: server-authoritative premium purchase and idempotent reward claims are exposed.
- 46 Event calendar: events, tournaments, seasons and banners are aggregated in one calendar API.
- 47 Social: friends, rivals, messages, mute/block/unblock actions and message read-state are wired with auth/rate limits.
- 48 Reports: target validation, self-report prevention, rate limiting and moderator/admin status workflow are enforced.
- 49 Disputes: participant-only creation, evidence submission and audited admin decisions are wired.
- 50 Anti-fraud: security-event rate limits and idempotent financial operations protect high-risk flows.
- 51 Trust/reputation: trust/reputation fields and match progression hooks remain centralized in user/progression data.
- 52 Roles: SUPERADMIN-only maintenance/critical platform settings remain enforced; admin/moderator workflows are separated.
- 53 Audit log: admin settings, events, seasons, reports and dispute actions write audit records.
- 54 SUPER_ADMIN dashboard: aggregated admin endpoint exposes platform/users/matches/finance/server/fraud metrics.
- 55 Revenue analytics: transaction categories and commission/referral financial records are queryable by admin analytics.
- 56 Global settings: platform settings API validates range and step for commission/referral and operational values.
- 57 Feature flags: persisted FeatureFlag API supports runtime enable/disable controls.
- 58 Maintenance: persisted maintenance flag with non-user bypass is available through the maintenance gate/API.
- 59 i18n: one LanguageContext/source with RU/UA/EN/PL dictionaries, persisted language selection and document language fallback is in place; remaining page copy audit is part of final QA.
- 60 Mobile: responsive shell/components are covered by the global CSS and existing page layouts; final viewport smoke test remains required.
- 61 Notifications: persisted Notification model/API supports unread/read state; social/challenge/friend flows emit notifications.
- 62 Live refresh: LIVE/match pages use dynamic APIs and refresh controls; final live-state smoke test remains required.
- 63 Webhooks: provider endpoint validates HMAC and external event idempotency before persistence.
- 64 Steam Trade: inventory keeps Steam-oriented metadata/architecture for future trade provider integration; real Steam trade execution remains credential/provider dependent.
- 65 Monetization: Prime, DuelPass, XP boosters, cosmetic shop and referral monetization use server-side wallet operations.
- 66 Connected architecture: core modules share Prisma, auth, wallet, progression, settings and notification primitives.

## Final QA hardening pass
- 61 Notifications: unread badge count now queries the complete unread set instead of only the latest 20 notifications; read operations remain user-scoped.
- 47 Social: mute/block actions now reject missing or inactive targets before mutating relationships.
- 42 Seasons: OFF seasons are excluded from automatic active-season fallback; only active, in-window non-OFF seasons can drive site atmosphere.
- 41 Events: event updates validate premium price, promo multiplier, and date ranges before persistence.
- Verification: repository-wide TypeScript/TSX parser scan remains 0 syntax errors.
- 9 Deposit promotions: active promotion selection now honors amount/provider/first-deposit restrictions; bonus grants are persisted with wagering, withdrawability and expiry; completion is idempotent and applies to both local and admin-approved deposits.
- 10 Creators: CreatorProfile/Hub remain intact; payout availability is calculated transactionally to prevent concurrent over-requests, while admin payout lifecycle remains audited and role-protected.
