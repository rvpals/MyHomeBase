-- Tools: the delimited text files a reader has uploaded to browse.
--
-- Metadata only, exactly like tol_uploaded_databases (0097). Both of a file's
-- artefacts -- the original text and the SQLite sidecar its rows were loaded
-- into -- live in the workspace folder named by MYHOMEBASE_TOOLS_CSV_UPLOAD_ROOT.
-- See the .md log for why the rows go into a sidecar rather than staying text.
CREATE TABLE tol_uploaded_csv_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The name the file had on the reader's machine. Display only: the stored
  -- names are generated, and no path is ever built from this.
  original_file_name TEXT NOT NULL,
  -- The generated name of the uploaded text, inside the upload root. Kept so
  -- the bytes as uploaded are still recoverable; never rewritten by an edit.
  stored_file_name TEXT NOT NULL UNIQUE,
  -- The generated name of the SQLite sidecar the rows were loaded into. This
  -- is what every read and write after the import touches.
  table_file_name TEXT NOT NULL UNIQUE,
  -- One of , \t ; | -- as sniffed at import or as the reader corrected it.
  -- Stored so an export writes the file back out the way it came in. Read
  -- forgivingly: an unrecognised value resolves to a comma rather than making
  -- the file unopenable, since these rows are reachable from the SQL Explorer.
  delimiter TEXT NOT NULL,
  has_header_row INTEGER NOT NULL DEFAULT 1,
  -- The column names as a JSON array, in file order. A list rather than its own
  -- table: it is read and written whole, always with its file, and never joined
  -- or filtered on -- so a child table would be a join for no query that exists.
  -- The sidecar's own columns are positional (c0..cN), and this is what names
  -- them, which is also why an edit can address a header like `select` or
  -- `1st Qtr` without quoting trouble.
  column_names TEXT NOT NULL,
  -- Rows at import, corrected as rows are deleted, so the picker can say how
  -- big a file is without opening its sidecar.
  row_count INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  -- ON DELETE SET NULL, not CASCADE: an upload is shared with everyone granted
  -- the module, so deleting the account that brought it must not delete the
  -- file out from under the others. The list then reads "Unknown".
  uploaded_by_user_id INTEGER REFERENCES sys_users(id) ON DELETE SET NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The list renders newest-first, which is the only ordering this table is read in.
CREATE INDEX idx_tol_uploaded_csv_files_uploaded_at
  ON tol_uploaded_csv_files(uploaded_at DESC);
