# DuelPlay — VPS match manager setup

This project now separates the web app from the CS2 process. The web app can stay on Vercel. The CS2 match manager runs only on the VPS.

## 1. Web environment

Set these variables in the deployed DuelPlay app:

```env
DUELPLAY_API_URL=https://YOUR-DUELPLAY-DOMAIN
DUELPLAY_SERVER_MANAGER_SECRET=LONG_RANDOM_SECRET
CS2_RESULT_SECRET=ANOTHER_LONG_RANDOM_SECRET
```

`DUELPLAY_SERVER_MANAGER_SECRET` must match the VPS manager. Never expose it to the browser.

## 2. VPS manager environment

Copy `scripts/server-manager/.env.example` to `scripts/server-manager/.env` and fill it in. For the current VPS it should look like:

```env
DUELPLAY_API_URL=https://YOUR-DUELPLAY-DOMAIN
DUELPLAY_SERVER_MANAGER_SECRET=LONG_RANDOM_SECRET
CS2_GSI_TOKEN=LONG_RANDOM_SECRET
CS2_DIR=/home/ubuntu/cs2/game
CS2_PUBLIC_HOST=YOUR_PUBLIC_VPS_IP
CS2_PORT=27015
DUELPLAY_SERVER_ID=cs2-1
DUELPLAY_MANAGER_PORT=3010
CS2_READY_DELAY_MS=20000
```

## 3. Node.js

The manager uses only Node's built-in modules and `fetch`. Node.js 20+ is required.

## 4. Install the service

Place this project at `/home/ubuntu/duelplay-app` on the VPS, then run:

```bash
cd /home/ubuntu/duelplay-app
sudo bash scripts/server-manager/install-vps.sh
```

The installer enables and starts `duelplay-cs2-manager.service`.

Check it with:

```bash
systemctl status duelplay-cs2-manager
journalctl -u duelplay-cs2-manager -f
```

## 5. Match flow

1. Two users join a DuelPlay 1v1 and both stakes are locked.
2. A participant presses `Start match`.
3. The website marks the duel as queued for the manager.
4. The manager claims the only available server.
5. CS2 starts with two slots and bots are force-kicked before the server is announced ready.
6. The room receives the generated `steam://connect/...` link.
7. The manager observes the CS2 match state/logs and determines the final team winner.
8. The manager calls the protected result API with the verified SteamID.
9. DuelPlay settles the wallets and marks the match `FINISHED`.
10. The manager sends `quit`, the server becomes `OFFLINE`, and the next queued duel can use it.

## 6. Important limitation of the first MVP

There is one physical CS2 server, so matches are sequential, not simultaneous. This is intentional for the first real end-to-end test. Later we can add a pool of ports/processes/VPS instances.

CS2 Game State Integration is included as an additional signal, but Linux dedicated-server GSI has had compatibility issues in some CS2 builds. The manager therefore also listens to server-side logs and maps the final winning team to the two verified SteamIDs.

## 7. Do not run a second CS2 instance

After the manager is enabled, do not manually start another CS2 process on port `27015`. The manager owns the lifecycle.
