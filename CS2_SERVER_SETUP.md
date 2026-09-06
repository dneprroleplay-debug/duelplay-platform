# CS2 1v1 — подключение игрового сервера

Текущая версия сайта уже не позволяет вручную выбрать победителя. После нажатия «Начать матч» матч становится `LIVE`.

## Переменные

В `.env`:

```env
CS2_SERVER_CONNECT_URL="steam://connect/YOUR_SERVER_IP:27015"
CS2_RESULT_SECRET="long-random-secret"
```

`CS2_SERVER_CONNECT_URL` — ссылка Steam для подключения к выделенному серверу.

`CS2_RESULT_SECRET` — секрет, который знает только сайт и серверный referee.

## Referee result API

После завершения настоящего CS2-матча игровой сервер должен отправить:

```http
POST /api/matches/<MATCH_ID>/result
x-cs2-result-secret: <CS2_RESULT_SECRET>
Content-Type: application/json
```

Тело:

```json
{
  "winnerSteamId": "7656119..."
}
```

или:

```json
{
  "winnerId": "<DUELPLAY_USER_UUID>"
}
```

Endpoint проверяет, что:
- запрос пришёл с правильным секретом;
- матч существует;
- матч находится в `LIVE`;
- победитель является одним из двух игроков;
- ставка всё ещё заблокирована.

После этого в одной транзакции:
- победитель получает выплату;
- заблокированные ставки снимаются;
- создаются транзакции;
- обновляются XP/репутация;
- матч становится `FINISHED`.

## Важное ограничение

Сам сайт не может из браузера создать полноценный CS2 dedicated server. Для настоящего теста нужен доступный сервер CS2 и серверный referee/manager, который запускает матч, знает SteamID игроков и отправляет результат.

Следующий этап разработки — связать `Начать матч` с вашим dedicated-server manager и передавать ему ID дуэли, игроков, карту и секрет для callback.


# DuelPlay automated match server (new)

The old manual `tmux` launch is useful for diagnostics, but the production path is the server manager. Do not run a second CS2 process on port 27015 while the manager is active.

## Required web environment

- `DUELPLAY_SERVER_MANAGER_SECRET` — shared secret for the manager API.
- `CS2_RESULT_SECRET` — secret used by the referee result endpoint. It may be the same random value for the MVP, but separate secrets are recommended.
- `DUELPLAY_API_URL` — deployed DuelPlay URL.

## Required VPS environment

See `scripts/server-manager/.env.example`. The important values are `DUELPLAY_API_URL`, `DUELPLAY_SERVER_MANAGER_SECRET`, `CS2_GSI_TOKEN`, `CS2_DIR`, `CS2_PUBLIC_HOST`, and `CS2_PORT`.

## Lifecycle

`READY` → player clicks Start → manager claims server → CS2 starts → bots are kicked → manager marks match `LIVE` → players connect → GSI detects `gameover` → result API settles payout → manager sends `quit` → server becomes `OFFLINE`.

If the server cannot become ready or exits while a match is still `LIVE`, the server API cancels the match and refunds both locked stakes.
