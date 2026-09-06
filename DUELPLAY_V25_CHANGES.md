# DuelPlay v25

- Added localized Cases link to the main header and mobile menu.
- Added hover lift, accent border/glow, and image/preview zoom for admin Settings theme and background-atmosphere cards, matching the existing hero-image hover behavior.
- Hardened home intro trigger so the full DUELPLAY intro plays exactly once per navigation event, including React Strict Mode in development.
- Removed the separate animated LoadingScreen from the home flow; initial loading now uses a static black gate so the intro is not played twice.
- Standardized displayed 1v1 text to 1х1 across source UI strings.
