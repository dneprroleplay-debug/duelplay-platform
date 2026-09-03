# DuelPlay

DuelPlay is a CS2 1v1 competitive matchmaking web app built with Next.js, React, TypeScript, Tailwind CSS, Prisma and PostgreSQL.

## Current product scope

- CS2 1v1 matchmaking
- USD only
- Minimum bet: **$3**
- Maximum bet: $10,000
- 10% commission from the total pot
- Map selection cards automatically select the map in Create Match
- One temporary server option: the server selector is intentionally hidden
- PostgreSQL-backed LIVE lobby
- Registration, login, logout and HTTP-only sessions
- Player profile with level, XP, reputation, trust score, referral code and match statistics
- USD wallet with locked balance and transaction history
- Internal test balance for development/testing
- Match lifecycle: WAITING → READY → LIVE → FINISHED / CANCELLED
- Joining a match reserves the second player's stake
- Test start-match action
- Server-managed match start, GSI referee result and automatic server shutdown (VPS manager)
- Refund on creator cancellation
- Real ranking data from PostgreSQL
- Full RU / UA / EN / PL UI translation with persisted language selection
- Local fallback avatars; no remote GitHub avatar dependency

## Real CS2 match orchestration

The web app and the CS2 server are intentionally separate. Vercel/Next.js never starts a CS2 process. The VPS runs `scripts/server-manager/server-manager.mjs`, which:

- waits for a READY 1v1 that was explicitly started by a player;
- claims the single available CS2 server;
- starts CS2 with exactly 2 player slots;
- force-kicks bots and sets the 1v1 server rules after startup;
- exposes a per-match `steam://connect/host:port` URL to the room;
- receives CS2 Game State Integration (GSI) updates;
- detects the final winning team and maps it to the two verified Steam IDs;
- submits the winner to `/api/matches/[id]/result`;
- stops the CS2 process after the result is accepted;
- releases the server record so the next duel can use it.

The current MVP intentionally uses one physical server/port sequentially. A second match waits until the current match releases the server.

### VPS setup

1. Deploy the web app and set the new secrets from `.env.example`.
2. Copy the project (or at least `scripts/server-manager`) to `/home/ubuntu/duelplay-app` on the CS2 VPS.
3. Set `scripts/server-manager/.env` from its example.
4. Ensure Node.js 20+ is installed.
5. Run `sudo bash scripts/server-manager/install-vps.sh`.
6. Check `systemctl status duelplay-cs2-manager` and `journalctl -u duelplay-cs2-manager -f`.

The manager generates the required CS2 GSI configuration automatically.

## Important production boundaries

Steam OAuth, Steam game/server verification, real payment processors, withdrawals, anti-fraud, referee infrastructure, disputes and production payout controls are not faked. The current project contains the application-side foundation and internal test flows; production integrations must be connected with real credentials, webhooks and security controls.

## Run locally

1. Copy `.env.example` to `.env`.
2. Put your existing PostgreSQL `DATABASE_URL` in `.env`.
3. Install dependencies:

```bash
npm install
```

4. Generate Prisma Client:

```bash
npx prisma generate
```

5. Start development server:

```bash
npm run dev
```

6. Open `http://localhost:3000`.

## Optional seed

```bash
npx prisma db seed
```

Test users from the seed:

- `test@duelplay.local` / `Test12345!`
- `rival@duelplay.local` / `TestRival12345!`

## Test flow

Register/login → open Create Match → select a map card or map in the form → create a $3+ match → open a second browser/incognito session → register/login as another user → join from LIVE → open the match → Start match → choose a winner → verify wallet balances and transaction history.

## DuelPlay UI v10.5
- Wolf branding from the approved DuelPlay artwork is bundled in `public/branding/duelplay-wolf.png`.
- Fixed atmospheric theme backgrounds live in `public/theme-backgrounds/` and remain visible while scrolling.
- Payment method artwork lives in `public/payment-methods/`.
- Bundled starter top-skin assets live in `public/top-skins/`; admin-added community skins are persisted in PostgreSQL so they survive Vercel deploys.
- Admin can send system notifications; users receive them through the header bell.
- Admin can add community avatar presets; they become available in the profile avatar picker.
