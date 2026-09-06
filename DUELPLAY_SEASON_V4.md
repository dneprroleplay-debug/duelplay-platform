# DuelPlay Season Atmosphere v4

- Global seasonal atmosphere is applied from the root layout.
- Active season is exposed as `html[data-season]` and CSS variables.
- Seasonal art overlays the existing CS2 hero/create backgrounds instead of replacing them.
- Winter / Christmas / New Year add dense snowfall and snow caps to panels, articles, map selection cards and case roulette cards.
- Spring / Easter add flower edges; Summer adds warm glow; Autumn / Thanksgiving add leaf edges; Halloween adds pumpkin/ghost edges; Valentine's adds hearts; St. Patrick's adds clover; Lunar New Year adds lanterns; April Fools adds confetti; Esports adds neon framing.
- Added seasonal SVG art under `public/season-backgrounds/` for all presets.
- Expanded SUPERADMIN presets: Winter, Spring, Summer, Autumn, New Year, Christmas, Halloween, Easter, Valentine's Day, St. Patrick's Day, April Fools, Lunar New Year, Thanksgiving, Esports, None.
- Season activation stores `seasonId` in effects so the frontend can select the correct visual preset immediately.
