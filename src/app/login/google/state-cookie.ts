// The cookie the Google OAuth state token travels in, shared by the two halves
// of the flow: `./route.ts` sets it, `./callback/route.ts` checks and clears it.
//
// Its own file because a `route.ts` may only export route handlers and a fixed
// set of config keys. Exporting a constant from one makes Next's generated route
// types fail to typecheck ("Property 'STATE_COOKIE_NAME' is incompatible with
// index signature"), even though the code runs.

export const STATE_COOKIE_NAME = "myhomebase_google_oauth_state";

/** Five minutes — long enough to finish a sign-in, short enough to be useless later. */
export const STATE_COOKIE_MAX_AGE_SECONDS = 5 * 60;
