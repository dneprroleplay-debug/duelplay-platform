# DuelPlay Admin

## Levels
- SUPPORT (1): support tickets, read-only operational data.
- MODERATOR (2): player status, moderation and match oversight.
- ADMIN (3): all operational controls plus wallet adjustments and standard theme.
- SUPERADMIN (5): all admin controls, role management and security settings.

## Bootstrap
Set `DUELPLAY_ADMIN_EMAIL` and `DUELPLAY_ADMIN_PASSWORD` in `.env`, then run `npx prisma db push` and `npx prisma db seed`. This creates/updates `DuelPlayOwner` as SUPERADMIN.

## Important
Balance adjustments are intentionally available only from the admin panel while real payment providers are not connected. Self-service balance crediting is disabled.
