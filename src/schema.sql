-- web-annotate-kit — schema
-- Compatible with SQLite, libsql (Turso), and PostgreSQL with minor adjustments.

CREATE TABLE IF NOT EXISTS reviews (
  id             TEXT PRIMARY KEY,
  author         TEXT NOT NULL,
  author_color   TEXT,
  page           TEXT NOT NULL,
  x              REAL NOT NULL,         -- percent of viewport width (0-100)
  y              INTEGER NOT NULL,      -- pixels from top of page
  text           TEXT NOT NULL,
  created_at     TEXT NOT NULL,         -- ISO 8601
  updated_at     TEXT,
  resolved       INTEGER DEFAULT 0,     -- legacy boolean (0/1). Kept in sync with `status`.
  status         TEXT NOT NULL DEFAULT 'open', -- 'open' | 'accepted' | 'resolved'
  department     TEXT NOT NULL DEFAULT 'general',
  notes          TEXT NOT NULL DEFAULT '[]',   -- JSON array of ReviewNote
  accepted_at    TEXT,
  accepted_by    TEXT,
  section        TEXT,
  nearest_text   TEXT,
  selector       TEXT,
  tag_name       TEXT,
  screenshot_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviews_page ON reviews(page);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_department ON reviews(department);

CREATE TABLE IF NOT EXISTS wak_departments (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280'
);

CREATE TABLE IF NOT EXISTS wak_users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,        -- scrypt(password, salt) hex; format: "scrypt$<salt>$<hash>"
  color          TEXT NOT NULL DEFAULT '#6B7280',
  role           TEXT NOT NULL,        -- 'reviewer' | 'lead' | 'director' | 'admin'
  department_id  TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wak_users_role ON wak_users(role);
