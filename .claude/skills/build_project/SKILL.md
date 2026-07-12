---
name: build_project
description: >
  Build MyHomeBase for production (npm run build / build.bat) and report the
  result. Use only when explicitly asked to build the project — not
  automatically after code changes. Triggers on "/build_project", "build the
  project", "build for production", "does it build".
---

# Build MyHomeBase

Runs the Next.js production build for this project and reports the result.

## When to use

Only when explicitly asked to build the project. Do not run this proactively
after unrelated code changes — verification steps in this project only run
when asked.

## Steps

1. Run `npm run build` (equivalent to `build.bat`) from the project root via
   Bash.
2. `next build` already includes TypeScript type-checking and ESLint as part
   of the build itself — don't separately run `npm run typecheck` or
   `npm run lint` before or after. Don't run `npm test` either; that's a
   separate, explicitly-requested step.
3. If the build fails:
   - Show the relevant error output (the actual compiler/lint error, not the
     full log).
   - Stop there. Don't attempt a fix unless asked.
4. If the build succeeds:
   - Report the route summary Next.js prints (static vs. dynamic routes).

## Notes

- The `.next/` build output is a disposable artifact — fine to leave in place,
  no need to clean it up or ask about it.
- This skill does not run `npm run db:migrate`. Building the app doesn't touch
  the database.
