import type { ReviewRecord, ReviewStorage } from './types.js';

interface SqliteOptions {
  path: string;
}

interface BetterSqliteDatabase {
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): { changes: number };
  };
  exec(sql: string): void;
  close(): void;
}

function rowToRecord(row: Record<string, unknown>): ReviewRecord {
  return {
    id: row.id as string,
    author: row.author as string,
    authorColor: (row.author_color as string) ?? null,
    page: row.page as string,
    x: Number(row.x),
    y: Number(row.y),
    text: row.text as string,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) ?? null,
    resolved: Number(row.resolved) === 1,
    section: (row.section as string) ?? null,
    nearestText: (row.nearest_text as string) ?? null,
    selector: (row.selector as string) ?? null,
    tagName: (row.tag_name as string) ?? null,
    screenshotUrl: (row.screenshot_url as string) ?? null,
  };
}

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    author TEXT NOT NULL,
    author_color TEXT,
    page TEXT NOT NULL,
    x REAL NOT NULL,
    y INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    resolved INTEGER DEFAULT 0,
    section TEXT,
    nearest_text TEXT,
    selector TEXT,
    tag_name TEXT,
    screenshot_url TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_page ON reviews(page);
  CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);
`;

export async function sqliteStorage(options: SqliteOptions): Promise<ReviewStorage> {
  let Database: new (path: string) => BetterSqliteDatabase;
  try {
    // @ts-expect-error — optional peer, resolved at runtime
    const mod = await import('better-sqlite3');
    Database = (mod.default ?? mod) as unknown as new (path: string) => BetterSqliteDatabase;
  } catch {
    throw new Error(
      "web-annotate-kit: sqliteStorage requires 'better-sqlite3'. Install it: npm i better-sqlite3",
    );
  }

  const db = new Database(options.path);
  db.exec(CREATE_SQL);

  return {
    async list() {
      const rows = db.prepare('SELECT * FROM reviews ORDER BY created_at ASC').all() as Record<string, unknown>[];
      return rows.map(rowToRecord);
    },
    async insert(r) {
      db.prepare(
        `INSERT INTO reviews (id, author, author_color, page, x, y, text, created_at, updated_at, resolved, section, nearest_text, selector, tag_name, screenshot_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        r.id, r.author, r.authorColor, r.page, r.x, r.y, r.text, r.createdAt,
        r.updatedAt, r.resolved ? 1 : 0, r.section, r.nearestText, r.selector, r.tagName, r.screenshotUrl,
      );
    },
    async updateText(id, text, updatedAt) {
      db.prepare('UPDATE reviews SET text = ?, updated_at = ? WHERE id = ?').run(text, updatedAt, id);
    },
    async updateScreenshot(id, screenshotUrl) {
      db.prepare('UPDATE reviews SET screenshot_url = ? WHERE id = ?').run(screenshotUrl, id);
    },
    async toggleResolved(id) {
      const row = db.prepare('SELECT resolved FROM reviews WHERE id = ?').get(id) as { resolved: number } | undefined;
      if (!row) return;
      const next = row.resolved === 1 ? 0 : 1;
      db.prepare('UPDATE reviews SET resolved = ? WHERE id = ?').run(next, id);
    },
    async delete(id) {
      const row = db.prepare('SELECT screenshot_url FROM reviews WHERE id = ?').get(id) as { screenshot_url: string | null } | undefined;
      db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
      return row?.screenshot_url ?? null;
    },
  };
}
