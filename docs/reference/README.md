# Reference material — not part of the app

Everything under `docs/reference/` is illustrative and is **not** part of MyHomeBase.
Claude Code should not treat it as application code or wire it into the build.

## create-user-example/
A small, runnable demonstration of the core pattern from `ARCHITECTURE.md`: one
`createUser` use-case in `src/lib/`, called identically from a web adapter
(`src/app/actions.ts`) and a CLI adapter (`src/cli/create-user.ts`), with a unit test
using a fake repository. It has its own `package.json`; to try it:

    cd docs/reference/create-user-example
    npm install
    npm run cli -- create-user --email a@b.com --name "Alice" --password secret123
    npm run ui-demo
    npm test

Keep it as a living reference, or delete the `docs/reference/` folder once the real
codebase has equivalent examples.
