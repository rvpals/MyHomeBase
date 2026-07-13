ALTER TABLE users ADD COLUMN google_email TEXT;

CREATE UNIQUE INDEX users_google_email_idx ON users(google_email) WHERE google_email IS NOT NULL;
