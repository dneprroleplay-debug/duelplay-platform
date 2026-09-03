# DuelPlay v9 — real CS2 match lifecycle

This version connects the existing web match lifecycle to a separate VPS CS2 manager.

## What was added

- Persistent `GameServer` model and migration.
- Protected server-manager API.
- `Start match` queues a READY duel instead of pretending the game is already LIVE.
- VPS manager starts CS2 with `-maxplayers 2`.
- Bots are disabled and kicked before the server is announced ready.
- The match room receives a per-match Steam connect URL.
- CS2 server logs are monitored for final match-clinch events and player Steam3 IDs are converted to Steam64 IDs.
- Optional CS2 GSI receiver is included as an additional signal.
- Winner is submitted to the existing protected result endpoint.
- Result endpoint settles the internal test wallet, updates XP/reputation, records the source, and creates notifications.
- After settlement the manager sends `quit` and releases the server record.
- Server startup failures/unexpected exits refund locked stakes and cancel the match.
- Systemd service and installer are included for the VPS.

## What still requires external setup

- Deploy the new Prisma migration to the production database.
- Add the three manager secrets/URLs to the web deployment and VPS environment.
- Install Node.js 20+ on the VPS if it is not already installed.
- Copy this project to the VPS (or copy the `scripts/server-manager` directory) and enable the systemd service.
- Test with two Steam accounts.
- Real payments, withdrawals, KYC/AML, and production anti-fraud remain intentionally outside this test build.

## Current scaling model

One physical CS2 server/port is used sequentially. Match #2 waits until match #1 has finished and its CS2 process has been stopped. A future server pool can allocate several ports/instances/VPS hosts concurrently.
