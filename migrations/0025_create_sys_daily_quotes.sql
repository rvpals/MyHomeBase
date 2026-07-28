CREATE TABLE sys_daily_quotes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  quote      TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT 'Unknown',
  category   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER daily_quotes_set_updated_at
AFTER UPDATE ON sys_daily_quotes
FOR EACH ROW
BEGIN
  UPDATE sys_daily_quotes SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Starter quotes so the home-screen widget has something to show on first run.
INSERT INTO sys_daily_quotes (quote, author, category) VALUES
  ('The only way to do great work is to love what you do.', 'Steve Jobs', 'Motivation'),
  ('Life is what happens when you''re busy making other plans.', 'John Lennon', 'Life'),
  ('The future belongs to those who believe in the beauty of their dreams.', 'Eleanor Roosevelt', 'Inspiration'),
  ('Success is not final, failure is not fatal: it is the courage to continue that counts.', 'Winston Churchill', 'Success'),
  ('Happiness is not something ready made. It comes from your own actions.', 'Dalai Lama', 'Happiness'),
  ('The only true wisdom is in knowing you know nothing.', 'Socrates', 'Wisdom');
