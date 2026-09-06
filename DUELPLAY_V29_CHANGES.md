# DuelPlay v29 — mobile/tablet safety pass

- Preserved the complete v28 match/join flow and all existing server-side match logic.
- Improved the mobile admin layout: smaller phone heading and reduced panel padding while keeping desktop spacing unchanged.
- Improved the mobile header account actions: Create Match / Wallet / Inventory stack on narrow phones and return to a 3-column row at `sm`.
- Reduced match player-card padding on phones without changing tablet/desktop dimensions.
- Fixed corrupted Polish CS2 connection copy on the match page (`CZAS NA POŁĄCZENIE`, `Połącz się z serwerem CS2`).
- No match lifecycle, wallet, Steam, admin permissions, Prisma schema, or VPS manager behavior was changed.
