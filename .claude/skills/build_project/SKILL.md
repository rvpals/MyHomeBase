---
name: build_project
description: >
  MyHomeBase's release checkpoint: log changes to CHANGE_HISTORY.md, verify
  (typecheck/lint/test/build) with a confirmation gate, sync docs, then
  commit everything together. Use only when explicitly asked — not
  automatically after code changes. Triggers on "/build_project", "build the
  project", "check in the changes", "ship this".
---

# Build MyHomeBase

A release checkpoint for this project: document what changed, verify it,
sync the docs, and commit — in that order, as one coherent step.

## When to use

Only when explicitly asked. Do not run this proactively after unrelated code
changes — verification and commits in this project only happen when asked.

## Steps

Run these in order. Don't skip or reorder them — later steps depend on
earlier ones (docs are updated before the commit so everything lands
together).

### 1. Log the changes

- Get the current date/time (e.g. `date "+%Y-%m-%d %H:%M"`).
- Look at what actually changed: `git status` and `git diff` (staged and
  unstaged) against `HEAD`. Use the conversation context too — the diff shows
  *what* changed, but the conversation usually explains *why*.
- Write a short summary (a handful of bullets, not a wall of text) and
  prepend it to `CHANGE_HISTORY.md` as a new dated entry, newest first. If the
  file doesn't exist yet, create it with a `# Change History` heading.
- Display the new entry to the user.

### 2. Verify

Run, in order, and show the output of each:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run build`

Then **stop and explicitly ask the user whether to continue** before touching
docs or git, regardless of whether everything passed. Don't proceed past this
point without an explicit go-ahead — if something failed, say so plainly and
let the user decide whether to fix it first, proceed anyway, or stop.

### 3. Sync the docs

Before committing (so this lands in the same commit as the code): check
whether `CLAUDE.md`, `ARCHITECTURE.md`, `components.md`, and any other
project `.md` docs still accurately describe the current state — new
modules, new conventions, new registered components, changed scripts, etc.
Update only what's actually stale; don't rewrite files that are still
accurate just to touch them.

### 4. Commit

- Review `git status`/`git diff` once more so nothing unexpected (secrets,
  stray debug files) is about to be staged.
- Stage the changes (including `CHANGE_HISTORY.md` and any doc updates from
  step 3) and commit with a message summarizing the change — the
  `CHANGE_HISTORY.md` entry from step 1 is a good source for the message.
- Don't push. This project has no remote configured, and pushing is a
  separate, explicit decision in any case.

## Notes

- If `.git` doesn't exist for some reason, stop and ask before running
  `git init` — don't silently create a repository.
- `.next/` is a disposable build artifact from step 2 — no need to clean it
  up or ask about it.
- This skill does not run `npm run db:migrate`. Schema/data migrations are a
  separate, explicit action.
