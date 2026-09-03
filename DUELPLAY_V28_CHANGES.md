# DuelPlay v28 — Match join from match page

## Final UX update

- Added a **Join** button directly to the individual match page while the match is waiting for a second player.
- The button uses the existing `/api/matches/[id]/join` flow, so balance locking and match state changes remain on the server.
- The button is hidden for the match creator and appears only while the match is `WAITING_FOR_PLAYERS`.
- Join errors are mapped through the active language dictionary on the client for the existing error codes (`AUTH_REQUIRED`, `OWN_MATCH`, `MATCH_FULL`, `INSUFFICIENT_BALANCE`, `JOIN_ERROR`).
- After a successful join, the match page refreshes its state and shows the existing localized READY message.
- No new project or replacement architecture was introduced; this is an update of v27.
