// The width every full-page screen is laid out in — modules, Administration and
// the home grid alike.
//
// One value, not a per-screen cap. Screens used to pick their own (`3xl` = 768px
// for most modules, `4xl` for the admin forms, `6xl` for the wide ones), which
// left most of a large display as empty margin either side of the content.
//
// The 160rem (2560px) cap is the only limit left, and it's deliberately set past
// a 2560px monitor so it doesn't bind on one: it exists purely to stop a table or
// a line of text spanning a 3440px ultrawide, where the eye can't track a row
// back to its label. Lower it if lines start feeling too long.
//
// A plain module (no "use client"), so server components can import it — an
// export from a client module reaches the server as an unusable reference.
export const PAGE_CONTAINER = "mx-auto w-full max-w-[160rem]";
