# DuelPlay server manager

Run this only on the CS2 VPS, not on Vercel.

Required environment:
- `DUELPLAY_API_URL`
- `DUELPLAY_SERVER_MANAGER_SECRET`
- `CS2_GSI_TOKEN`

Optional environment is documented in `.env.example`.


## CS2 build synchronization

The manager updates and validates the dedicated CS2 server with SteamCMD before it starts accepting DuelPlay matches. This prevents a stale dedicated-server build from producing the Steam/CS2 "client out of date" error when a player joins from the current Steam client.

Set `CS2_AUTO_UPDATE=false` only if the VPS has another controlled update mechanism. If `steamcmd` is not in PATH, set `STEAMCMD_BIN` to its full executable path.

The READY connection URL is the standard `steam://connect/HOST:PORT` form. The VPS must also allow inbound UDP traffic on the configured CS2 port (default `27015`).
