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
- Test winner selection and payout flow
- Refund on creator cancellation
- Real ranking data from PostgreSQL
- Full RU / UA / EN / PL UI translation with persisted language selection
- Local fallback avatars; no remote GitHub avatar dependency

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
