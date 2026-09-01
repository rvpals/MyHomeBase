# 0078 — A deployment history, with the build log attached

**Date:** 2026-09-01
**Type:** new table (`sys_deployments`) + one index

## What this does

Creates `sys_deployments`, one row per deployment that goes live, carrying the console
output of the build that produced it. The About screen grows a **Deployments** tab that
lists them and can delete individual rows.

Nothing needs adding to `DEFAULT_MODULES`: this is a tab on an existing admin screen, not
a module. The prefix is `sys_` because a deployment record is platform bookkeeping, not a
feature module's data.

## Why the build log is shipped rather than written directly

This is the whole design constraint, and it is not obvious from the table.

The build runs on **Windows** (`npm run publish:nas`). The database it would need to write
lives on the **NAS**. Writing a live SQLite database across SMB risks corrupting it — the
app holds the file open in WAL mode — which is exactly why `set-startup-message.cjs` runs
on the NAS instead of inside `REBUILD_PUBLISH_NAS.bat`, and why `start.sh` applies
migrations there too. The same rule applies here.

So the log travels as a file and the row is written locally:

```
Windows   npm run publish:nas
          └─ tees its own console output into a buffer
          └─ writes dist-nas/build-log.json
             { buildId, appVersion, builtAt, builtOnHost, nodeAbi, packageSizeBytes, output }

          robocopy ──▶ NAS

NAS       start.sh, DEPLOYED=1 branch only
          └─ node record-deployment.cjs [--migrated]
             └─ INSERT INTO sys_deployments        ← local write
```

Two consequences worth stating:

- **`deployed_at` is stamped on the NAS**, not carried in the JSON, so it is the moment the
  build actually went live rather than the moment it finished compiling. `built_at` keeps
  the build moment separately, and the gap between them is genuinely interesting — it is
  how long a release sat in staging.
- **A crash-restart records nothing.** The insert is gated on `DEPLOYED=1`, the same gate
  the startup message and the migration step use. A process that died and came back is not
  a deployment and must not claim to be one, or the history stops meaning anything.

## Why every build-log column is nullable

Only `deployed_at` and `migrated` are `NOT NULL`. Everything else — including `build_id`
and `app_version` — can be null.

`record-deployment.cjs` must be able to insert a row when `build-log.json` is absent or
unparseable: a package built before this change, a folder copied across by hand, a
truncated file. The alternative is refusing the insert, which loses the deployment record
altogether — a strictly worse outcome than a row that says "something deployed at this
time and I don't know what". The reader sees `—` in those cells.

## Why `build_output` is one TEXT column

The captured log stays an opaque blob, a few KB per row. It is read by a human in a `<pre>`
in the record-view modal, so any parsing here would be inventing structure that the next
change to `publish-nas.mjs` would invalidate. The About view shows it verbatim.

## Retention

**Unbounded, and pruned by hand.** There is no auto-trim. A deployment every few days with
a few KB of log each is negligible against a ~6 MB database, and the point of the feature
is that you decide what history is worth keeping — hence the per-row delete rather than a
retention window. Revisit if this ever gets noisy.

## Reversibility

Reversible — `DROP TABLE sys_deployments;` and the index goes with it. Nothing else
references the table: no foreign keys point at it, and no other feature reads it. Dropping
it loses the recorded history, which exists nowhere else once `dist-nas/` is rebuilt.

## Deployment note

`start.sh` is **excluded from the publish on purpose** so a republish can't clobber the
file the boot task runs. The new `record-deployment.cjs` block therefore does not take
effect until `start.sh` is copied to the NAS by hand:

```powershell
scp start.sh <user>@NAS_DS223:/volume1/app/myhomebase/
ssh <user>@NAS_DS223 "chmod +x /volume1/app/myhomebase/start.sh"
```

Until that happens everything else works and the tab simply stays empty — no deployment is
recorded, and nothing breaks. The `chmod` matters: the boot task runs that exact file, so a
`start.sh` that lands without its `+x` bit stops the app coming back on the next restart.

## Verification

```sql
-- The table and its index exist.
SELECT name FROM sqlite_master WHERE name IN ('sys_deployments', 'idx_deployments_deployed_at');

-- After the first triggered deploy, exactly one row, newest first.
SELECT id, deployed_at, built_at, build_id, app_version, migrated,
       LENGTH(build_output) AS output_bytes
FROM sys_deployments ORDER BY deployed_at DESC;

-- The CHECK holds.
INSERT INTO sys_deployments (deployed_at, migrated) VALUES ('2026-09-01T00:00:00Z', 2);
-- Expect: CHECK constraint failed
```
