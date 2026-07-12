# createUser — one function, called from UI and from a batch file

Demonstrates the architecture rule: **the logic lives once, in the library, and every
front-end is a thin adapter that calls it.** The web UI and a Windows batch file both
invoke the *same* `createUser` use-case and produce the same result in the same store.

## Where the logic lives (and only lives)

`src/lib/user/user.ts` → `createUser(input, repo)`. It validates, enforces the
"email not taken" rule, hashes the password, builds the domain object, and saves it.
Nothing else creates a user.

## The two callers — both are ~4 lines

- **UI:** `src/app/actions.ts` → `createUserAction(form)` parses the form, calls
  `createUser`, returns a UI-safe shape. (In real Next.js this file is a `"use server"`
  server action wired to `<form action={createUserAction}>`.)
- **CLI / batch:** `src/cli/create-user.ts` → `createUserCommand(argv)` parses argv,
  calls `createUser`, prints the result. `create-user.bat` wraps it.

Neither caller contains any user-creation logic. Adding the batch file required zero
changes to `src/lib/`.

## What makes it swappable and testable

`createUser` depends on the `UserRepository` *interface* (`ports.ts`), not a concrete
database. The real one (`repository.ts`) is chosen once in `wiring.ts`; the unit tests
pass an in-memory fake. Same function, three different data sources, no code changes.

## Run it

    npm install

    # CLI / batch path
    npm run cli -- create-user --email bob@cli.com --name "Bob" --password secret123
    # or on Windows:  create-user.bat --email bob@cli.com --name "Bob" --password secret123

    # UI path (stand-in for the form submit)
    npm run ui-demo

    # unit tests (fake repo, no I/O)
    npm test

Both write to `users.json` (override with the USERS_DB env var), proving they are the
same operation.

## Production note
For a shipped build you'd compile to JS and have the .bat call `node dist/cli/index.js`
instead of `npx tsx`. The structure is identical.
