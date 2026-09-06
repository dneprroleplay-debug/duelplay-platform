# DuelPlay CS2 server manager

The manager is intentionally a separate VPS process. Vercel/Next.js should never try to spawn CS2 itself.

## Install on the VPS

1. Copy `server-manager/.env.example` to `server-manager/.env` and fill in the private values.
2. From the DuelPlay project run `npm install` and then `npm run server-manager`.
3. The manager creates these CS2 configs automatically:
   - `game/csgo/cfg/gamemode_competitive_server.cfg`
   - `game/csgo/cfg/gamestate_integration_duelplay.cfg`
4. The manager polls DuelPlay for a READY match, claims the single server, starts CS2 with 2 slots, force-kicks bots, announces the server to the site, receives CS2 Game State Integration updates, posts the winner to the result API, then sends `quit` and frees the server.

## Important

The first MVP uses one physical CS2 instance/port (`27015`) sequentially. A second match waits until the first server is released. Later this can be expanded to a pool of VPS instances/ports.
