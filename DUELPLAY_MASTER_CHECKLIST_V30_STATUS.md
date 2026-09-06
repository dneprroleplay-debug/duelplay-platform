# v30.4 QA FIXES
- Fixed React hydration mismatch caused by reading localStorage during the initial language state render.
- Added idempotent PostgreSQL migration for Match.startDeadlineAt, Match.connectionDeadlineAt, and Match.connectionPhaseCompleted so an existing v29 database can be upgraded without blindly replacing data.

# DuelPlay MASTER CHECKLIST — v30 implementation review

1. IMPLEMENTED: lifecycle + READY timer + STARTING state + watchdog hooks
2. IMPLEMENTED: 2m/10m deadlines + connectionPhaseCompleted
3. IMPLEMENTED/REINFORCED: heartbeat 10s, Steam normalization, log/GSI watchdog
4. IMPLEMENTED: DB server pool selection foundation
5. IMPLEMENTED/REINFORCED: wallet locking + idempotent transaction keys
6. IMPLEMENTED: SUPERADMIN platform settings API, 0-50 / 0.5 validation
7. IMPLEMENTED: Steam referral binding + referral stats foundation
8. IMPLEMENTED: promo campaign schema foundation
9. IMPLEMENTED: deposit promotion schema foundation
10. IMPLEMENTED: creator profile schema/API foundation
11. IMPLEMENTED: creator payout states/schema
12. IMPLEMENTED: public profile API with private wallet data excluded
13. IMPLEMENTED: challenge inbox/create/expiration foundation
14. IMPLEMENTED: friends API + block/remove foundation
15. IMPLEMENTED: rivals API foundation
16. FOUNDATION: modes schema remains extensible; matchmaking UI/algorithm not complete
17. IMPLEMENTED: leaderboard API + rating foundation
18. FOUNDATION: league data can be derived from rating; seasonal UI not complete
19. IMPLEMENTED: streak fields + result updates foundation
20. FOUNDATION: analytics fields/schema; GSI ingestion not fully persisted
21. IMPLEMENTED: XP/level fields and rewards foundation
22. IMPLEMENTED: achievement catalog + user achievements schema/seed
23. IMPLEMENTED: daily mission schema/API foundation
24. IMPLEMENTED: 30-day login reward schema/API
25. IMPLEMENTED: extensible mode schema; current playable mode remains 1v1
26. FOUNDATION: tournament schema/API; bracket engine/UI not complete
27. IMPLEMENTED: clan schema/API foundation
28. FOUNDATION: clan wars schema
29. IMPLEMENTED: live match API already present
30. IMPLEMENTED: server-side case roll architecture
31. IMPLEMENTED: case result idempotency foundation
32. IMPLEMENTED: inventory statuses + sell-to-balance API
33. IMPLEMENTED: collection schema foundation
34. IMPLEMENTED: rarity/value schema foundation
35. IMPLEMENTED: cosmetic shop schema/API foundation
36. IMPLEMENTED: Prime subscription schema/API foundation
37. IMPLEMENTED: DuelPass schema/API foundation
38. IMPLEMENTED: XP booster schema/API foundation
39. FOUNDATION: referral data supports leaderboard; race UI/calculation not complete
40. FOUNDATION: banner schema
41. IMPLEMENTED: event engine schema/API foundation
42. FOUNDATION: season engine schema
43. FOUNDATION: holiday event model via generic events
44. FOUNDATION: Halloween is representable via events/missions/rewards
45. IMPLEMENTED: event pass schema
46. IMPLEMENTED: event data API foundation
47. FOUNDATION: social API building blocks
48. IMPLEMENTED: report API
49. IMPLEMENTED: disputes already existed + audit model
50. IMPLEMENTED/REINFORCED: Steam uniqueness, idempotency, fraud models
51. IMPLEMENTED: trust/reputation fields
52. IMPLEMENTED: roles + server-side admin checks
53. IMPLEMENTED: audit log + setting changes
54. IMPLEMENTED: admin dashboard data endpoint foundation
55. IMPLEMENTED: revenue aggregation foundation
56. IMPLEMENTED: global numeric settings API
57. IMPLEMENTED: feature flags API
58. FOUNDATION: maintenance can be represented by feature flag; global UI gate not added
59. IMPLEMENTED: central RU/UA/EN/PL provider already present and retained
60. EXISTING: responsive UI retained; full device-by-device QA not executable without browser runtime
61. IMPLEMENTED: notification infrastructure retained/expanded enum
62. IMPLEMENTED: polling/live refresh already present and lifecycle fields added
63. FOUNDATION: API/webhook-ready routes can be added without coupling; external connectors not configured
64. IMPLEMENTED: inventory trade states/schema foundation; Steam Trade remains external
65. IMPLEMENTED: monetization data model foundation; no pay-to-win mechanics added
66. IMPLEMENTED: systems are connected through shared User/Match/Wallet/Inventory/Event/Admin schema
67. PARTIAL: local user production build confirmed successful after fixes; remaining DB/browser runtime QA requires local environment
68. IMPLEMENTED: original v29 archive modified in place and packaged as a single ZIP

Note: items marked FOUNDATION/EXTERNAL/PARTIAL are intentionally not represented as production-complete. Real payment processors, Steam Trade, Discord/Twitch/Telegram credentials, production CS2 hosts, and browser/device QA require external infrastructure or a running environment.
