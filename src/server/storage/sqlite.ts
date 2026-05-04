import type {
  DepartmentRecord, DepartmentStorage,
  ReviewNoteRecord, ReviewRecord, ReviewStatus, ReviewStorage,
  UserRecord, UserStorage,
} from './types.js';
import { verifyPassword } from '../auth.js';

interface SqliteOptions { path: string }

interface BetterSqliteDatabase {
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): { changes: number };
  };
  exec(sql: string): void;
  close(): void;
}

function rowToReview(row: Record<string, unknown>): ReviewRecord {
  let notes: ReviewNoteRecord[] = [];
  try {
    const raw = (row.notes as string) ?? '[]';
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) notes = parsed as ReviewNoteRecord[];
  } catch { /* fall back to empty */ }

  const status = ((row.status as string) ?? 'open') as ReviewStatus;
  return {
    id: row.id as string,
    authorId: (row.author_id as string) ?? null,
    author: row.author as string,
    authorColor: (row.author_color as string) ?? null,
    page: row.page as string,
    x: Number(row.x),
    y: Number(row.y),
    text: row.text as string,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) ?? null,
    status,
    resolved: status === 'resolved',
    department: (row.department as string) ?? 'general',
    notes,
    acceptedAt: (row.accepted_at as string) ?? null,
    acceptedBy: (row.accepted_by as string) ?? null,
    acceptedById: (row.accepted_by_id as string) ?? null,
    section: (row.section as string) ?? null,
    nearestText: (row.nearest_text as string) ?? null,
    selector: (row.selector as string) ?? null,
    tagName: (row.tag_name as string) ?? null,
    screenshotUrl: (row.screenshot_url as string) ?? null,
  };
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    passwordHash: row.password_hash as string,
    color: row.color as string,
    role: row.role as UserRecord['role'],
    departmentId: (row.department_id as string) ?? null,
    createdAt: row.created_at as string,
  };
}

function rowToDept(row: Record<string, unknown>): DepartmentRecord {
  return { id: row.id as string, name: row.name as string, color: row.color as string };
}

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    author_id TEXT,
    author TEXT NOT NULL,
    author_color TEXT,
    page TEXT NOT NULL,
    x REAL NOT NULL,
    y INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    resolved INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    department TEXT NOT NULL DEFAULT 'general',
    notes TEXT NOT NULL DEFAULT '[]',
    accepted_at TEXT,
    accepted_by TEXT,
    accepted_by_id TEXT,
    section TEXT,
    nearest_text TEXT,
    selector TEXT,
    tag_name TEXT,
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
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    color         TEXT NOT NULL DEFAULT '#6B7280',
    role          TEXT NOT NULL,
    department_id TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wak_users_role ON wak_users(role);
`;

/** Add a column if missing (sqlite has no IF NOT EXISTS for ADD COLUMN). */
function ensureColumn(db: BetterSqliteDatabase, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export async function sqliteStorage(options: SqliteOptions): Promise<{
  reviews: ReviewStorage;
  users: UserStorage;
  departments: DepartmentStorage;
}> {
  let Database: new (path: string) => BetterSqliteDatabase;
  try {
    // @ts-expect-error — optional peer, resolved at runtime
    const mod = await import('better-sqlite3');
    Database = (mod.default ?? mod) as unknown as new (path: string) => BetterSqliteDatabase;
  } catch {
    throw new Error("web-annotate-kit: sqliteStorage requires 'better-sqlite3'. Install it: npm i better-sqlite3");
  }

  const db = new Database(options.path);
  db.exec(CREATE_SQL);

  // Migrate pre-0.3 schemas: add new columns to a pre-existing reviews table.
  ensureColumn(db, 'reviews', 'status', "TEXT NOT NULL DEFAULT 'open'");
  ensureColumn(db, 'reviews', 'department', "TEXT NOT NULL DEFAULT 'general'");
  ensureColumn(db, 'reviews', 'notes', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'reviews', 'accepted_at', 'TEXT');
  ensureColumn(db, 'reviews', 'accepted_by', 'TEXT');
  ensureColumn(db, 'reviews', 'author_id', 'TEXT');
  ensureColumn(db, 'reviews', 'accepted_by_id', 'TEXT');

  // Backfill: any pre-existing row with resolved=1 gets status='resolved'
  db.exec(`UPDATE reviews SET status = 'resolved' WHERE resolved = 1 AND (status IS NULL OR status = 'open')`);

  /* ── Reviews ──────────────────────────────────────────── */
  const reviews: ReviewStorage = {
    async list() {
      const rows = db.prepare('SELECT * FROM reviews ORDER BY created_at ASC').all() as Record<string, unknown>[];
      return rows.map(rowToReview);
    },
    async insert(r) {
      db.prepare(
        `INSERT INTO reviews (id, author_id, author, author_color, page, x, y, text, created_at, updated_at,
                               resolved, status, department, notes, accepted_at, accepted_by, accepted_by_id,
                               section, nearest_text, selector, tag_name, screenshot_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        r.id, r.authorId, r.author, r.authorColor, r.page, r.x, r.y, r.text, r.createdAt, r.updatedAt,
        r.status === 'resolved' ? 1 : 0, r.status, r.department, JSON.stringify(r.notes ?? []),
        r.acceptedAt, r.acceptedBy, r.acceptedById,
        r.section, r.nearestText, r.selector, r.tagName, r.screenshotUrl,
      );
    },
    async updateText(id, text, updatedAt) {
      db.prepare('UPDATE reviews SET text = ?, updated_at = ? WHERE id = ?').run(text, updatedAt, id);
    },
    async updateScreenshot(id, screenshotUrl) {
      db.prepare('UPDATE reviews SET screenshot_url = ? WHERE id = ?').run(screenshotUrl, id);
    },
    async setStatus(id, status: ReviewStatus, opts) {
      const acceptedAt = opts?.acceptedAt ?? null;
      const acceptedBy = opts?.acceptedBy ?? null;
      const acceptedById = opts?.acceptedById ?? null;
      db.prepare(
        `UPDATE reviews SET status = ?, resolved = ?,
            accepted_at = COALESCE(?, accepted_at),
            accepted_by = COALESCE(?, accepted_by),
            accepted_by_id = COALESCE(?, accepted_by_id)
         WHERE id = ?`,
      ).run(status, status === 'resolved' ? 1 : 0, acceptedAt, acceptedBy, acceptedById, id);
    },
    async toggleResolved(id) {
      const row = db.prepare('SELECT status FROM reviews WHERE id = ?').get(id) as { status: string } | undefined;
      if (!row) return;
      const next: ReviewStatus = row.status === 'resolved' ? 'open' : 'resolved';
      db.prepare('UPDATE reviews SET status = ?, resolved = ? WHERE id = ?').run(next, next === 'resolved' ? 1 : 0, id);
    },
    async addNote(id, note: ReviewNoteRecord) {
      const row = db.prepare('SELECT notes FROM reviews WHERE id = ?').get(id) as { notes: string } | undefined;
      if (!row) return;
      let arr: ReviewNoteRecord[] = [];
      try { const p = JSON.parse(row.notes ?? '[]'); if (Array.isArray(p)) arr = p; } catch { /* ignore */ }
      arr.push(note);
      db.prepare('UPDATE reviews SET notes = ? WHERE id = ?').run(JSON.stringify(arr), id);
    },
    async delete(id) {
      const row = db.prepare('SELECT screenshot_url FROM reviews WHERE id = ?').get(id) as { screenshot_url: string | null } | undefined;
      db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
      return row?.screenshot_url ?? null;
    },
  };

  /* ── Users ────────────────────────────────────────────── */
  const users: UserStorage = {
    async list() {
      const rows = db.prepare('SELECT * FROM wak_users ORDER BY name COLLATE NOCASE ASC').all() as Record<string, unknown>[];
      return rows.map(rowToUser);
    },
    async findByPassword(password) {
      const rows = db.prepare('SELECT * FROM wak_users').all() as Record<string, unknown>[];
      for (const row of rows) {
        const u = rowToUser(row);
        if (verifyPassword(password, u.passwordHash)) return u;
      }
      return null;
    },
    async findById(id) {
      const row = db.prepare('SELECT * FROM wak_users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      return row ? rowToUser(row) : null;
    },
    async insert(record) {
      db.prepare(
        `INSERT INTO wak_users (id, name, password_hash, color, role, department_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(record.id, record.name, record.passwordHash, record.color, record.role, record.departmentId, record.createdAt);
    },
    async update(id, patch) {
      const fields: string[] = [];
      const args: unknown[] = [];
      const map: Record<string, string> = {
        name: 'name', passwordHash: 'password_hash', color: 'color', role: 'role', departmentId: 'department_id',
      };
      for (const k of Object.keys(patch) as Array<keyof typeof patch>) {
        const col = map[k as string];
        if (!col) continue;
        fields.push(`${col} = ?`);
        args.push(patch[k] ?? null);
      }
      if (!fields.length) return;
      args.push(id);
      db.prepare(`UPDATE wak_users SET ${fields.join(', ')} WHERE id = ?`).run(...args);
    },
    async delete(id) { db.prepare('DELETE FROM wak_users WHERE id = ?').run(id); },
    async count() {
      const row = db.prepare('SELECT COUNT(*) AS c FROM wak_users').get() as { c: number };
      return Number(row.c);
    },
  };

  /* ── Departments ──────────────────────────────────────── */
  const departments: DepartmentStorage = {
    async list() {
      const rows = db.prepare('SELECT * FROM wak_departments ORDER BY name COLLATE NOCASE ASC').all() as Record<string, unknown>[];
      return rows.map(rowToDept);
    },
    async upsert(record) {
      db.prepare(
        `INSERT INTO wak_departments (id, name, color) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color`,
      ).run(record.id, record.name, record.color);
    },
    async delete(id) { db.prepare('DELETE FROM wak_departments WHERE id = ?').run(id); },
    async count() {
      const row = db.prepare('SELECT COUNT(*) AS c FROM wak_departments').get() as { c: number };
      return Number(row.c);
    },
  };

  return { reviews, users, departments };
}
