# DuelPlay — Security Hardening / Production Runbook

Этот файл фиксирует эксплуатационные требования после точечного security-hardening. Рабочая игровая и финансовая архитектура не заменяется.

## 1. Обязательные environment variables

На WEB VPS:

- `DATABASE_URL` — PostgreSQL собственного WEB VPS, не Neon.
- `DUELPLAY_SERVER_MANAGER_SECRET` — отдельный секрет Server Manager API.
- `CS2_RESULT_SECRET` — отдельный секрет, только для `/api/matches/[id]/result`.
- `DUELPLAY_MFA_ENCRYPTION_KEY` — 64 hex-символа (32 bytes AES-256).
- `R2_ENDPOINT`, `R2_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — R2 backup target.
- `DUELPLAY_LOCAL_TEST_MODE=false`.

На CS2 VPS должны быть заданы одновременно `DUELPLAY_SERVER_MANAGER_SECRET` и `CS2_RESULT_SECRET`, и они должны отличаться.

Перед production deploy выполнить:

```bash
npm run prod:validate-env
```

## 2. Session migration

Migration `20260920120000_security_hardening` добавляет `adminMfaVerifiedAt` и отзывает старые DB session records, чтобы прежние raw bearer tokens больше не работали.

После применения migration пользователям потребуется новый вход.

## 3. Отдельный вход администратора

Административный вход отделён от обычного Steam-входа игроков:

- `/admin/login` — вход по никнейму и персональному паролю;
- каждый администратор получает собственный пароль через одноразовое приглашение;
- при выдаче административной роли `/api/admin` создаёт ссылку `/admin/setup?token=...`, действующую 30 минут;
- пароль хешируется через `scrypt`, сам пароль нигде не показывается и не сохраняется в открытом виде;
- повторная выдача ссылки сбрасывает старый admin-пароль и отзывает активные admin-сессии;
- при снятии административной роли пароль удаляется и сессии отзываются;
- админский cookie подписывается отдельным `DUELPLAY_ADMIN_AUTH_SECRET`, поэтому одной обычной Steam-сессии недостаточно для доступа к `/admin`.

`DUELPLAY_ADMIN_AUTH_SECRET` хранится только в secret management/Coolify и не попадает в Git.

## 4. Admin MFA

Admin-level routes требуют TOTP MFA. Первый вход администратора выполняет setup/verify через `/admin`.

`DUELPLAY_MFA_ENCRYPTION_KEY` хранится только в secret management/Coolify и не попадает в Git.

## 5. API security hardening

Критичные API проходят server-side проверки до бизнес-операции:

- auth / authorization / ownership;
- rate limiting для чувствительных действий;
- CS2 Manager, result и watchdog используют отдельные secrets;
- server-side secrets сравниваются constant-time;
- legacy `/api/users/create` возвращает `410 Gone`;
- прямые изменения `Wallet.lockedBalance` вне `lib/wallet.ts` запрещены;
- match/refund/payout/dispute settlement использует WalletHold lifecycle и idempotency;
- платёжный депозит использует idempotency, привязанную к самому `Deposit.id`, поэтому повторная доставка с другим webhook event ID не создаёт повторное зачисление.

Admin audit сохраняет requestId, результат операции и причину, а для нижних административных ролей чувствительные контактные/финансовые поля пользователей не выдаются.

## 6. PostgreSQL backup → R2

Ежедневный backup:

```bash
npm run backup:postgres:r2
```

Рекомендуемый cron на WEB VPS — 1 раз в сутки. Скрипт сам использует `flock`, поэтому параллельный backup не запускается. Cron запускает команду из директории приложения с production environment variables. Не хранить AWS/R2 secrets в crontab.

Backup сохраняется в R2 с retention, заданным `R2_BACKUP_RETENTION_DAYS`.

## 7. Restore verification

Restore test выполняется только в disposable PostgreSQL database:

```bash
npm run restore:test:postgres:r2
```

Никогда не указывать production database в `RESTORE_DATABASE_URL`: restore script использует `pg_restore --clean --if-exists`.

## 8. CS2 result security

Server Manager использует:

- `DUELPLAY_SERVER_MANAGER_SECRET` для своих manager endpoints.
- `CS2_RESULT_SECRET` для публикации подтверждённого результата матча.

Не объединять эти секреты.

## 9. Release checks

Перед production cutover:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npx tsc --noEmit
npm run build
npm run prod:validate-env
```

После deploy отдельно проверить реальный CS2 VPS: START 2 минуты, CONNECTION 5 минут, technical win, refund, GRENADE_ONLY и map-placed weapon pickup. Не считать CS2-проблему исправленной только по статическому тесту.

## Final hardening pass — API / idempotency / admin boundary

- Critical admin mutations, including maintenance mode, require the dedicated admin session and fresh MFA.
- Maintenance mode has a separate IP rate limit.
- Financial helper idempotency now verifies that an existing transaction belongs to the requested wallet owner before treating a request as idempotent.
- Client-supplied idempotency keys are bounded to 200 characters and scoped to the authenticated user at the API boundary.
- Public match responses do not expose the internal CS2 host/port.
- Public profile match history does not expose bet amounts.
- Admin invite setup removes the token from the browser address bar immediately after capture; the token is still submitted once over HTTPS to complete setup.
