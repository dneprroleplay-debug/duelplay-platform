# DuelPlay Production — self-hosted WEB

Целевая схема:

- Cloudflare — DNS + proxy/SSL
- WEB VPS — Ubuntu 24.04 LTS + Coolify
- Coolify — Next.js/API + PostgreSQL + scheduled jobs
- Current CS2 VPS — Dedicated Server + Server Manager
- GitHub — source code
- S3-compatible backup storage — PostgreSQL backups
- Cloudflare R2 — большие пользовательские файлы/медиа

## WEB VPS

Рекомендуемый старт: 8 vCPU / 16 GB RAM / 160–240 GB NVMe.

На WEB VPS не размещаем CS2 Dedicated Server.

## Coolify

Создать PostgreSQL как отдельный service/database в Coolify и задать `DATABASE_URL` для приложения.

Приложение разворачивать из GitHub через `Dockerfile` из корня репозитория.

Health check:

`/api/health`

Migration command уже встроен в container start:

`npx prisma migrate deploy && npm start`

## Обязательные production variables

- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL=https://duelplay.com`
- `STEAM_RETURN_URL=https://duelplay.com/api/auth/steam/callback`
- `DUELPLAY_SERVER_MANAGER_SECRET`
- `CS2_RESULT_SECRET`
- `DUELPLAY_JOB_SECRET`
- `DUELPLAY_OWNER_STEAM_ID`
- `DUELPLAY_PAYMENT_PROVIDER` — только после выбора реального провайдера
- `DUELPLAY_PAYMENT_WEBHOOK_SECRET` — только после выбора реального провайдера

`DUELPLAY_LOCAL_TEST_MODE=false` в production.

## Финансы

Production wallet работает только через PostgreSQL ledger/holds. Реальный deposit/withdrawal нельзя активировать одним флагом: сначала должен быть реализован и проверен конкретный payment gateway adapter.

## Backups

PostgreSQL backup — ежедневно во внешнее S3-compatible storage. Backup должен периодически проверяться восстановлением на отдельную БД.
