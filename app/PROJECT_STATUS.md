# DuelPlay — текущий этап

## Уже работает

- Авторизация и аккаунты
- Профиль и репутация
- Внутренний тестовый баланс
- Создание CS2 1v1 дуэли
- Блокировка ставки при создании
- Подключение второго игрока и блокировка его ставки
- Открытые дуэли и лобби
- Комната матча
- Отмена ожидающей дуэли
- PostgreSQL + Prisma
- RU / UA / EN / PL
- Рейтинг
- Кошелёк и транзакции

## Что изменено в этой версии

### Новый визуальный стиль
Фирменная палитра:
- Black 70%
- Pink 25%
- Green 5%

Розовый используется для CTA, навигации и ключевых игровых акцентов.
Зелёный используется для LIVE, online и успешных состояний.
Убраны лишние элементы вроде кейсов, рулетки, ежедневных бонусов и «быстрой игры».

### Реальный CS2 матч — подготовка
- Кнопка «Начать матч» больше не предлагает выбрать победителя вручную.
- После старта дуэль переводится в `LIVE`.
- Комната пытается показать Steam/CS2 подключение.
- Можно задать `CS2_SERVER_CONNECT_URL` в `.env`.
- Добавлен защищённый endpoint `/api/matches/[id]/result` для серверного CS2 referee.
- Выплата производится только через серверный результат.
- Ручной endpoint `/api/matches/[id]/finish` отключён.

## Следующий технический шаг

Подключить выделенный CS2 dedicated server / матч-сервер, который:
1. получает игроков и конфигурацию матча;
2. запускает 1v1;
3. после окончания определяет победителя;
4. отправляет подписанный запрос в `/api/matches/[id]/result`;
5. сайт переводит матч в `FINISHED` и разблокирует/начисляет средства.

Для теста нужен установленный CS2 у обоих игроков и доступный игровой сервер.

## Пока НЕ подключаем

- реальные деньги;
- банковские платежи;
- PayPal;
- крипту;
- SkinPay;
- реальные выводы.

Сначала полностью проверяем цикл настоящего CS2 1v1 на внутреннем тестовом балансе.


## UI/UX fixes — 2026-08-31
- Главный hero-lobby больше не содержит выдуманных статических дуэлей: список берётся из `/api/matches`.
- Счётчик активных дуэлей на главной синхронизирован с API.
- `/live` показывает READY и LIVE матчи; при пустом состоянии объясняет, когда матч появится.
- Авторизация DuelPlay выполняется только через Steam OpenID; Steam-регистрация отключена.
- Кошелёк теперь получает `lockedBalance` из `/api/auth/me`, поэтому заблокированная ставка отображается корректно.
- Заменён временный крестик в логотипе на фирменный знак `D`.


## UI v8 — themes and administration
- 10 personal interface themes in Profile.
- Standard theme is controlled from Admin and applies only to users with STANDARD preference.
- Admin can also set a custom standard accent color.
- 4 administrative levels: SUPPORT 1, MODERATOR 2, ADMIN 3, SUPERADMIN 5.
- Admin sections cover players, matches, finance, security, support and site settings.
- Self-service balance credit is disabled; administrative balance adjustment remains available.


## v8.5 — Steam auth and production-ready UI pass

- Added Steam OpenID login/registration at `/api/auth/steam`.
- Steam users receive a DuelPlay session and wallet automatically; existing Steam users are signed in.
- Optional `STEAM_API_KEY` imports the Steam persona name and avatar.
- Removed the self-service demo balance endpoint and demo-wallet wording.
- Language selector uses flag images and the UI has localized Steam/auth/theme/payment copy.
- Ten interface themes remain available; non-standard selections are stored as personal and are not overwritten by the site's standard theme.
- Header no longer exposes the text `Admin`; authorized staff get a compact control icon instead.
- Added mobile navigation and responsive spacing.
- Added `STEAM_SETUP.md` with local/Vercel configuration.

Administrative roles currently map to four permission levels: SUPPORT 1, MODERATOR 2, ADMIN 3, SUPERADMIN 5.

## v9 — automated CS2 match orchestration

- Added `GameServer` persistence and a one-server sequential allocation model.
- `Start match` now queues a READY duel for the VPS manager instead of immediately faking LIVE.
- Added protected server-manager claim/ready/heartbeat/failure/stopped APIs.
- Added a standalone Node.js VPS manager under `scripts/server-manager/`. It never runs on Vercel.
- Manager starts CS2 with `-maxplayers 2`, force-kicks bots, applies 1v1 server rules, publishes a per-match `steam://connect` URL, and shuts the process down after settlement.
- Added CS2 GSI configuration generation plus server-log referee fallback for Linux dedicated-server environments.
- Result callback now records the CS2 source and sends winner/finish notifications.
- Server startup failures and unexpected exits during LIVE refund locked stakes and cancel the match.
- Added systemd service and VPS installer instructions.

### Important
The current VPS manager is deliberately sequential: one physical CS2 server handles one DuelPlay match at a time. Scaling to multiple simultaneous matches is a later server-pool step.

Server manager remains a VPS-only process; the Vercel/Next.js app only orchestrates state through protected HTTP endpoints.
