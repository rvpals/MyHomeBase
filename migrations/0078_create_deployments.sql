-- A deployment history the About page can read. See migrations/0078_create_deployments.md.
--
-- One row per GO-LIVE, not per build. The distinction matters because the two happen on
-- different machines: `npm run publish:nas` builds on Windows, and the database it would
-- have to write lives on the NAS -- which must never be written over SMB (see
-- scripts/set-startup-message.ts for the same constraint, and why). So the build hands
-- its log forward in dist-nas/build-log.json, and start.sh inserts the row locally once
-- the new build is actually coming up.

CREATE TABLE sys_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- When the build went LIVE, stamped on the NAS at insert time. This is the column the
  -- history is ordered and read by: it is the only timestamp that answers "when did this
  -- app change?", which is the question the About tab exists to answer.
  deployed_at TEXT NOT NULL,

  -- Every column below comes from build-log.json and is therefore NULLABLE, deliberately.
  -- A deployment must still be recordable when that file is missing or unreadable -- an
  -- older package built before this migration, or a folder copied across by hand. A row
  -- with nothing but a timestamp is a true and useful record; refusing to insert one
  -- would lose the deployment entirely, which is the worse failure.
  built_at TEXT,
  build_id TEXT,
  app_version TEXT,
  built_on_host TEXT,
  node_abi INTEGER,
  package_size_bytes INTEGER,

  -- Whether start.sh applied pending migrations during this deployment. 0 rather than
  -- NULL as the default: "no migrations ran" is a known state for every deployment this
  -- code records, not an unknown one.
  migrated INTEGER NOT NULL DEFAULT 0 CHECK (migrated IN (0, 1)),

  -- The captured console output of `npm run publish:nas`. A few KB per row. Kept as one
  -- TEXT blob rather than parsed into columns because it is read by a human in a <pre>,
  -- and any structure imposed here would be a guess at what a future build step prints.
  build_output TEXT
);

-- The history is always read newest-first, and never filtered by anything else.
CREATE INDEX idx_deployments_deployed_at ON sys_deployments (deployed_at DESC);
