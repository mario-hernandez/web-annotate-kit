import type { ReviewRecord, ReviewStorage } from './types.js';

interface TursoOptions {
  url: string;
  authToken: string;
  bootstrap?: boolean; // run CREATE TABLE IF NOT EXISTS on init (default true)
}

interface LibsqlClient {
  execute(args: string | { sql: string; args: unknown[] }): Promise<{ rows: Record<string, unknown>[] }>;
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

export async function tursoStorage(options: TursoOptions): Promise<ReviewStorage> {
  let createClient: (cfg: { url: string; authToken: string }) => LibsqlClient;
  try {
    const mod = await import('@libsql/client');
    createClient = (mod.createClient ?? (mod as unknown as { default: { createClient: typeof createClient } }).default.createClient) as typeof createClient;
  } catch {
    throw new Error(
      "web-annotate-kit: tursoStorage requires '@libsql/client'. Install it: npm i @libsql/client",
    );
  }

  const db = createClient({ url: options.url, authToken: options.authToken });

  if (options.bootstrap !== false) {
    await db.execute(`CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY, author TEXT NOT NULL, author_color TEXT,
      page TEXT NOT NULL, x REAL NOT NULL, y INTEGER NOT NULL, text TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT, resolved INTEGER DEFAULT 0,
      section TEXT, nearest_text TEXT, selector TEXT, tag_name TEXT, screenshot_url TEXT
    )`);
  }

  return {
    async list() {
      const result = await db.execute('SELECT * FROM reviews ORDER BY created_at ASC');
      return result.rows.map(rowToRecord);
    },
    async insert(r) {
      await db.execute({
        sql: `INSERT INTO reviews (id, author, author_color, page, x, y, text, created_at, updated_at, resolved, section, nearest_text, selector, tag_name, screenshot_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [r.id, r.author, r.authorColor, r.page, r.x, r.y, r.text, r.createdAt, r.updatedAt, r.resolved ? 1 : 0, r.section, r.nearestText, r.selector, r.tagName, r.screenshotUrl],
      });
    },
    async updateText(id, text, updatedAt) {
      await db.execute({ sql: 'UPDATE reviews SET text = ?, updated_at = ? WHERE id = ?', args: [text, updatedAt, id] });
    },
    async updateScreenshot(id, screenshotUrl) {
      await db.execute({ sql: 'UPDATE reviews SET screenshot_url = ? WHERE id = ?', args: [screenshotUrl, id] });
    },
    async toggleResolved(id) {
      const current = await db.execute({ sql: 'SELECT resolved FROM reviews WHERE id = ?', args: [id] });
      if (!current.rows.length) return;
      const next = Number(current.rows[0].resolved) === 1 ? 0 : 1;
      await db.execute({ sql: 'UPDATE reviews SET resolved = ? WHERE id = ?', args: [next, id] });
    },
    async delete(id) {
      const row = await db.execute({ sql: 'SELECT screenshot_url FROM reviews WHERE id = ?', args: [id] });
      const url = row.rows[0] ? ((row.rows[0].screenshot_url as string | null) ?? null) : null;
      await db.execute({ sql: 'DELETE FROM reviews WHERE id = ?', args: [id] });
      return url;
    },
  };
}
