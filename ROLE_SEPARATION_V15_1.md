# DuelPlay role separation v15.1

Changes in this build:
- SUPERADMIN-only `/admin/operations` remains server-guarded.
- SUPERADMIN-only platform settings, feature flags, global site settings, seasons and role changes remain server-guarded.
- Standard theme mutation is now SUPERADMIN-only; regular admins no longer see the global Settings tab.
- Regular admin UI menu is filtered by role level.
- Lower roles do not receive financial totals in the admin dashboard response.
- Wallet credit/debit both require level 3+.
- Creator is available in the regular admin panel at level 3+ for creator payout review.
- Creator payout APPROVED/REJECTED is level 3+; PAID remains SUPERADMIN-only.
- Creator self-service `/creator` was not removed.
- No CS2/server-manager/gameplay code was changed.

Validation performed:
- Admin role separation: 12/12 PASS
- Roles policy: 8/8 PASS
- Public UI translation rules: PASS
- CS2 duel regression checks: PASS
- Live UI polling / Steam launch / AWP enforcement checks: PASS
- Presence/server deadline/match-state race regression checks: PASS

TypeScript/production build was not run in the packaging container because dependency installation timed out. Run locally:
  npx tsc --noEmit --pretty false
  npm run build
