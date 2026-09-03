# DuelPlay admin bootstrap (test database)

The test reset script removes all users and dependent test data, then creates one Steam-only account as `SUPERADMIN`.

Use only against the intended test database.

```powershell
npm.cmd run admin:reset-test -- 765611199012209747
```

The SteamID can also be supplied through `BOOTSTRAP_STEAM_ID` in `.env`.

The script uses `STEAM_API_KEY` when available to copy the current Steam nickname and avatar into the new profile. The API key is never printed.
