-- web-annotate-kit — reviews table
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
  resolved       INTEGER DEFAULT 0,     -- 0 = open, 1 = resolved
  section        TEXT,                  -- nearest <section> heading
  nearest_text   TEXT,                  -- text near the click point
  selector       TEXT,                  -- CSS path to the element
  tag_name       TEXT,                  -- e.g. "h2", "button"
  screenshot_url TEXT                   -- URL served by the server
);

CREATE INDEX IF NOT EXISTS idx_reviews_page ON reviews(page);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);
