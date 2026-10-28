# Advanced game-mode availability

The public REAL, DEMO, and matchmaking selectors use the same no-store availability endpoint (`GET /api/game-modes`). All ten modes are listed, but the two advanced modes are intentionally gated by the published server configuration rather than being enabled just because a client selects them.

## Speed Duel

1. Open the Admin Control Center's **Game modes** panel as FOUNDER or SUPERADMIN.
2. Enable **Speed Duel**, set a supported movement-speed percentage, and choose the allowed maps.
3. Validate and save the draft, then publish it.
4. Wait until `cs2-1`, `cs2-2`, and `cs2-3` acknowledge the exact same checksum and the revision is shown as published. The managers first report `STAGED` after the deployed controller accepts the revision, then `APPLIED` after the controller has applied it in a match.

Only then does Speed Duel become selectable in REAL, DEMO, and matchmaking. Backend routes independently validate the published configuration; the client selector is not the security boundary.

## Low Gravity

Low Gravity uses the reviewed policy `DUELPLAY_LOW_GRAVITY_V1` from `lib/duel-map-safety.mjs`. The policy covers every current duel map, was verified on 2026-10-28 with method `APPROVED_LOW_GRAVITY_POLICY`, and sets a **60% minimum** gravity for all maps. Admin validation, the server-manager config API, the public availability API, and matchmaking all consume the same profile list. The admin panel shows the applicable minimum next to the gravity setting.

Gravity values below the map minimum are rejected as unsafe. A map without a verified profile stays unavailable; do not insert guessed or fabricated `minimumSafeGravityPercent` values just to turn the mode on. Any future map must be added through the same reviewed policy before it can be selected.

## Runtime handling

The server manager pins the immutable mode/map snapshot for the match into `csgo/cfg/duelplay-match-mode.json` before launching CS2. The `DuelPlayModeController` CounterStrikeSharp plugin validates that snapshot, applies the settings, and writes `csgo/cfg/duelplay-mode-controller-state.json` with its version, capabilities, config version, checksum, applied values, and timestamp. The manager only reports `APPLIED` when the controller state matches the published revision.

The controller implements `BASE_CONFIG`, `LOW_GRAVITY`, `SPEED_DUEL`, and `GRENADE_COOLDOWN`. Low Gravity is capped at the approved 60% floor, and Speed Duel uses `sv_maxspeed` with `sv_accelerate_use_weapon_speed 0`. Unsupported, missing, or mismatched advanced-mode settings are rejected before starting a CS2 process. Inactive-mode config files are reset to neutral values between matches. Routine health checks do not update CS2; automatic game updates remain disabled by default.
