# DuelPlay V27 — deterministic CS2 Workshop map startup

## What changed

1. `lib/duel-maps.ts` remains the single source of truth for map IDs, server map names, and Workshop IDs.
2. `/api/server-manager/claim` resolves the selected map through `getDuelMap()` and returns its `workshopId`, `mapId`, display name, and Workshop URL.
3. The CS2 manager launches Workshop maps with:
   `+map de_dust2 +host_workshop_map <WORKSHOP_ID>`
   The official default map is used as the initial bootstrap map; `host_workshop_map` then loads the Workshop item.
4. Custom-map fallback guessing (for example `de_fy_pool_day`) is rejected by the manager when a Workshop ID is missing.
5. The match page has a `Download map` button that opens the exact Workshop item for the selected map. The existing Steam connect button is unchanged.
6. The existing UDP readiness probe remains in place: DuelPlay should not report `server ready` until the CS2 process is actually listening on the configured UDP port.

## Expected Pool Day startup

Pool Day (Classic) uses Workshop ID `3070923343` in the current catalog.

The manager should log something similar to:

`[DuelPlay] starting <matchId> on 51.83.131.167:27015 workshop=3070923343`

and CS2 should receive:

`+map de_dust2 +host_workshop_map 3070923343`

## Client without the map installed

The user can open `Download map` before connecting. This opens the exact Steam Workshop item. The user can subscribe/download it in Steam. The CS2 dedicated server itself downloads the Workshop map independently on the VPS; the server does not rely on the player's local files.

## Deployment

Upload the project archive and deploy the application normally. The server manager file from this archive must also be copied to:

`~/duelplay-app/scripts/server-manager/server-manager.mjs`

Then:

```bash
cd ~/duelplay-app
sudo systemctl restart duelplay-cs2-manager.service
sudo systemctl status duelplay-cs2-manager.service --no-pager
```

For a new match, verify:

```bash
sudo journalctl -u duelplay-cs2-manager.service -n 160 --no-pager
sudo ss -lunp | grep 27015
```

Do not mark the test as successful until the new manager process shows the Workshop ID, the CS2 command line contains `+host_workshop_map <ID>`, and UDP 27015 is actually listening.
