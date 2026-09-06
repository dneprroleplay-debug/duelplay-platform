# DuelPlay v23

- Replaced the browser `confirm()` used for SUPERADMIN support-ticket deletion with a DuelPlay-styled confirmation modal.
- Support-ticket deletion remains server-protected for SUPERADMIN only.
- Case roulette no longer jumps to the final position before the animation starts.
- Case roulette stops at a random point inside the winning card (from near the left edge to near the right edge), with zero gaps between cards.
- Added a dedicated `/cases` page. Inventory buttons now open the case page directly instead of returning to the home page.
- Updated the requested home-page copy and added translations for RU / UA / EN / PL.
- Added a full DuelPlay intro animation when navigating home through the header or clicking the logo.
- Removed the opaque black background from the supplied DuelPlay logo and use the transparent version in the header, wallet and favicon.
