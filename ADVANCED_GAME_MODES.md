# Advanced game-mode availability

The public REAL, DEMO, and matchmaking selectors use the same no-store availability endpoint (`GET /api/game-modes`). All ten modes are listed, but the two advanced modes are intentionally gated by the published server configuration rather than being enabled just because a client selects them.

## Speed Duel

1. Open the Admin Control Center's **Game modes** panel as FOUNDER or SUPERADMIN.
2. Enable **Speed Duel**, set a supported movement-speed percentage, and choose the allowed maps.
3. Validate and save the draft, then publish it.
4. Wait until `cs2-1`, `cs2-2`, and `cs2-3` acknowledge the exact same checksum and the revision is shown as published.

Only then does Speed Duel become selectable in REAL, DEMO, and matchmaking. Backend routes independently validate the published configuration; the client selector is not the security boundary.

## Low Gravity

Low Gravity remains visible but unavailable until the system has a real, verified safety profile for each selected map. No profiles are currently supplied by the server managers, so the application deliberately fails closed. Do not insert guessed or fabricated `minimumSafeGravityPercent` values just to turn the mode on. A future profile producer must establish the profile from a trusted and reviewable map-safety procedure and feed the same verified data into admin validation, the server-manager config API, the public availability API, and matchmaking.

## Runtime handling

The server manager consumes the immutable mode/map snapshot attached to the match. Unsupported, missing, or mismatched advanced-mode settings are rejected before starting a CS2 process. Speed and gravity config files are written from validated settings before launch, and inactive-mode config files are reset to neutral values between matches. Routine health checks do not update CS2; automatic game updates remain disabled by default.
