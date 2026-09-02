# Steam login setup

DuelPlay now supports Steam OpenID login/registration.

## Local

Set:

`STEAM_RETURN_URL=http://localhost:3000/api/auth/steam/callback`

The Steam button is available on both login and registration pages.

## Vercel

Set the same variable to the deployed callback URL, for example:

`https://your-domain.example/api/auth/steam/callback`

Optional:

`STEAM_API_KEY=...`

The API key is only used to import the Steam persona name and avatar. Steam OpenID identity verification itself does not depend on this key.

## Important

The Steam callback must be reachable from the internet on the deployed site. Keep `STEAM_RETURN_URL` out of client-side code.
