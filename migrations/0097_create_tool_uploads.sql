-- Tools: the SQLite files a reader has uploaded to browse.
--
-- Metadata only. The uploaded file itself lives in the workspace folder named by
-- MYHOMEBASE_TOOLS_UPLOAD_ROOT -- see the .md log for why the bytes are not a BLOB here.
CREATE TABLE tol_uploaded_databases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The name the file had on the reader's machine. Display only: the stored name
  -- is generated, and no path is ever built from this.
  original_file_name TEXT NOT NULL,
  -- The generated name inside the upload root. Unique so two readers uploading
  -- `data.db` cannot end up pointing at one file.
  stored_file_name TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL,
  -- ON DELETE SET NULL, not CASCADE: an upload is shared with everyone granted the
  -- module, so deleting the account that brought it must not delete the file out
  -- from under the others. The list then reads "Unknown".
  uploaded_by_user_id INTEGER REFERENCES sys_users(id) ON DELETE SET NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The list renders newest-first, which is the only ordering this table is read in.
CREATE INDEX idx_tol_uploaded_databases_uploaded_at
  ON tol_uploaded_databases(uploaded_at DESC);
