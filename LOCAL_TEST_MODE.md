# DuelPlay local test mode

When running locally (`NODE_ENV !== production`), two accounts marked `isTestAccount` can run a simulated server flow without Steam or a CS2 VPS.

Flow: create match -> second test account joins -> START -> LIVE (simulated) -> choose a test winner -> FINISHED and payout.

The local result endpoint is disabled in production. Test accounts are excluded from public ranking.

Optional `.env` flag:
`DUELPLAY_LOCAL_TEST_MODE=true`
