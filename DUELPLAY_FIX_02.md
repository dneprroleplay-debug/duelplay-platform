# DuelPlay Fix 02 — creator button, admin wallet, 10-minute notification

## Changes

1. The `Вы уже в дуэли` state on a waiting match is shown only to the second participant. The duel creator keeps the normal creator page and does not see this button.
2. SUPERADMIN wallet adjustments now explicitly cast PostgreSQL UUID values in the raw row-lock queries. This fixes PostgreSQL `42883: uuid = text` and allows credit/debit to reach the wallet transaction layer.
3. Administrative credit/debit operations use a fresh idempotency key for every explicit admin adjustment, so repeating the same amount/reason is allowed.
4. The 10-minute no-connection cancellation keeps creating a `CANCELLATION` notification for both players when the watchdog processes the timeout.
5. The notification UI now displays a concise `Матч отменён` title and a specific body explaining that nobody connected to CS2 within 10 minutes and the stake was refunded.

## Verification

`node scripts/test-duelplay-fix-02.mjs`

Result: all 8 focused checks passed.

## Important runtime note

The 10-minute timeout is server-authoritative. The watchdog must actually run at least once per minute (`npm run match-watchdog` or the protected `/api/jobs/match-watchdog` endpoint) for an expired LIVE match to be cancelled and for its notification/refund to be processed. The browser countdown itself does not mutate the match state.
