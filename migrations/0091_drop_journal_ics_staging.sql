-- Journal: remove the calendar-import staging table, which solved the wrong problem.
--
-- 0090 added `jrn_ics_staged_events` so the Calendar Import screen could page
-- over a large .ics instead of returning one row per event, on the theory that
-- a few thousand array elements were breaking Next's Server Action serializer.
--
-- That theory was wrong. The real fault was the *shape of the call*, not the
-- size of anything: a server action given a large string plus **any** further
-- argument is rejected before it runs with "Maximum array nesting exceeded",
-- because React wraps a multi-argument call in an array and charges that array
-- one slot per string character, against a 1,000,001-slot limit. A single
-- argument is not wrapped, so nothing is counted -- the same 2.4 MB file passes
-- alone and fails with a `{}` beside it.
--
-- The fix was to send the file as a FormData blob (binary on the wire, never
-- counted), which needs no table. So the staging machinery is gone, and this
-- drops what 0090 created.
--
-- IDEMPOTENT ON PURPOSE. This has to be a no-op on a database that never ran
-- 0090 -- which is every fresh install, since 0090's file has been deleted
-- rather than kept alongside this one. Only the deployed NAS database actually
-- has these objects, from the one deployment that applied 0090 before the
-- revert.

DROP INDEX IF EXISTS idx_jrn_ics_staged_uid;
DROP INDEX IF EXISTS idx_jrn_ics_staged_batch_index;

-- Nothing durable is lost. The table only ever held in-flight upload proposals;
-- a calendar event that was actually imported is a row in jrn_entries, and the
-- table was verified empty before this migration was written.
DROP TABLE IF EXISTS jrn_ics_staged_events;

-- The history row for the deleted 0090 file stays. Removing it would make the
-- runner treat 0090 as pending and fail looking for a file that no longer
-- exists; leaving it is an accurate record that the migration did once run
-- here. The `.md` log next to this file explains the pair to anyone reading
-- the sequence and wondering where 0090 went.
