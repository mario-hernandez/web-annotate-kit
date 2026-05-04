import type {
  DepartmentRecord, DepartmentStorage,
  ReviewNoteRecord, ReviewRecord, ReviewStatus, ReviewStorage,
  UserRecord, UserStorage,
} from './types.js';
import { verifyPassword } from '../auth.js';

interface TursoOptions {
  url: string;
  authToken: string;
  bootstrap?: boolean; // run CREATE TABLE IF NOT EXISTS on init (default true)
}

interface LibsqlClient {
  execute(args: string | { sql: string; args: unknown[] }): Promise<{ rows: Record<string, unknown>[] }>;
}

function rowToReview(row: Record<string, unknown>): ReviewRecord {
  const notes: ReviewNoteRecord[] = [];
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
    sessionVersion: Number(row.session_version ?? 1),
    createdAt: row.created_at as string,
  };
}

function rowToDept(row: Record<string, unknown>): DepartmentRecord {
  return { id: row.id as string, name: row.name as string, color: row.color as string };
}

async function ensureColumn(db: LibsqlClient, table: string, column: string, ddl: string) {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  } catch (e) {
    const msg = String((e as Error).message || '');
    // libsql throws "duplicate column name" when it already exists; swallow only that.
    if (!/duplicate column/i.test(msg)) throw e;
  }
}

export async function tursoStorage(options: TursoOptions): Promise<{
  reviews: ReviewStorage;
  users: UserStorage;
  departments: DepartmentStorage;
}> {
  let createClient: (cfg: { url: string; authToken: string }) => LibsqlClient;
  try {
    const mod = await import('@libsql/client');
    createClient = (mod.createClient ?? (mod as unknown as { default: { createClient: typeof createClient } }).default.createClient) as typeof createClient;
  } catch {
    throw new Error("web-annotate-kit: tursoStorage requires '@libsql/client'. Install it: npm i @libsql/client");
  }

  const db = createClient({ url: options.url, authToken: options.authToken });

  if (options.bootstrap !== false) {
    await db.execute(`CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY, author_id TEXT, author TEXT NOT NULL, author_color TEXT,
      page TEXT NOT NULL, x REAL NOT NULL, y INTEGER NOT NULL, text TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT, resolved INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      department TEXT NOT NULL DEFAULT 'general',
      notes TEXT NOT NULL DEFAULT '[]',
      accepted_at TEXT, accepted_by TEXT, accepted_by_id TEXT,
      section TEXT, nearest_text TEXT, selector TEXT, tag_name TEXT, screenshot_url TEXT
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS wak_departments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6B7280'
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS wak_users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, password_hash TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6B7280', role TEXT NOT NULL,
      department_id TEXT, session_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS wak_notes (
      id TEXT PRIMARY KEY, review_id TEXT NOT NULL,
      author_id TEXT, author TEXT NOT NULL, author_color TEXT NOT NULL,
      text TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_wak_notes_review_id ON wak_notes(review_id)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_wak_notes_created_at ON wak_notes(created_at)`);
    // Migrations for pre-0.3 databases
    await ensureColumn(db, 'reviews', 'status', "TEXT NOT NULL DEFAULT 'open'");
    await ensureColumn(db, 'reviews', 'department', "TEXT NOT NULL DEFAULT 'general'");
    await ensureColumn(db, 'reviews', 'notes', "TEXT NOT NULL DEFAULT '[]'");
    await ensureColumn(db, 'reviews', 'accepted_at', 'TEXT');
    await ensureColumn(db, 'reviews', 'accepted_by', 'TEXT');
    await ensureColumn(db, 'reviews', 'author_id', 'TEXT');
    await ensureColumn(db, 'reviews', 'accepted_by_id', 'TEXT');
    await ensureColumn(db, 'wak_users', 'session_version', 'INTEGER NOT NULL DEFAULT 1');

    // One-time migration: move JSON notes blob into wak_notes.
    const noteCount = await db.execute('SELECT COUNT(*) AS c FROM wak_notes');
    if (Number(noteCount.rows[0]?.c ?? 0) === 0) {
      const legacyRows = await db.execute(
        `SELECT id, notes FROM reviews WHERE notes IS NOT NULL AND notes != '[]' AND notes != ''`,
      );
      for (const row of legacyRows.rows) {
        try {
          const arr = JSON.parse((row.notes as string) ?? '[]');
          if (!Array.isArray(arr)) continue;
          for (const n of arr as ReviewNoteRecord[]) {
            await db.execute({
              sql: `INSERT OR IGNORE INTO wak_notes (id, review_id, author_id, author, author_color, text, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
              args: [n.id, row.id as string, n.authorId ?? null, n.author, n.authorColor ?? '#6B7280', n.text, n.createdAt],
            });
          }
        } catch { /* ignore malformed legacy rows */ }
      }
    }
    await db.execute(`UPDATE reviews SET status = 'resolved' WHERE resolved = 1 AND (status IS NULL OR status = 'open')`);
  }

  const reviews: ReviewStorage = {
    async list() {
      const r = await db.execute('SELECT * FROM reviews ORDER BY created_at ASC');
      const reviewsList = r.rows.map(rowToReview);
      if (reviewsList.length === 0) return reviewsList;
      const noteRows = await db.execute('SELECT * FROM wak_notes ORDER BY created_at ASC');
      const byReview = new Map<string, ReviewNoteRecord[]>();
      for (const n of noteRows.rows) {
        const reviewId = n.review_id as string;
        const arr = byReview.get(reviewId) ?? [];
        arr.push({
          id: n.id as string, authorId: (n.author_id as string) ?? null,
          author: n.author as string, authorColor: n.author_color as string,
          text: n.text as string, createdAt: n.created_at as string,
        });
        byReview.set(reviewId, arr);
      }
      for (const rv of reviewsList) rv.notes = byReview.get(rv.id) ?? [];
      return reviewsList;
    },
    async insert(r) {
      // Legacy `notes` column is always written as '[]'; real notes live in wak_notes.
      await db.execute({
        sql: `INSERT INTO reviews (id, author_id, author, author_color, page, x, y, text, created_at, updated_at,
                                    resolved, status, department, notes, accepted_at, accepted_by, accepted_by_id,
                                    section, nearest_text, selector, tag_name, screenshot_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          r.id, r.authorId, r.author, r.authorColor, r.page, r.x, r.y, r.text, r.createdAt, r.updatedAt,
          r.status === 'resolved' ? 1 : 0, r.status, r.department,
          r.acceptedAt, r.acceptedBy, r.acceptedById,
          r.section, r.nearestText, r.selector, r.tagName, r.screenshotUrl,
        ],
      });
    },
    async updateText(id, text, updatedAt) {
      await db.execute({ sql: 'UPDATE reviews SET text = ?, updated_at = ? WHERE id = ?', args: [text, updatedAt, id] });
    },
    async updateScreenshot(id, screenshotUrl) {
      await db.execute({ sql: 'UPDATE reviews SET screenshot_url = ? WHERE id = ?', args: [screenshotUrl, id] });
    },
    async setStatus(id, status: ReviewStatus, opts) {
      await db.execute({
        sql: `UPDATE reviews SET status = ?, resolved = ?,
                accepted_at = COALESCE(?, accepted_at),
                accepted_by = COALESCE(?, accepted_by),
                accepted_by_id = COALESCE(?, accepted_by_id)
              WHERE id = ?`,
        args: [status, status === 'resolved' ? 1 : 0,
               opts?.acceptedAt ?? null, opts?.acceptedBy ?? null, opts?.acceptedById ?? null, id],
      });
    },
    async toggleResolved(id) {
      const cur = await db.execute({ sql: 'SELECT status FROM reviews WHERE id = ?', args: [id] });
      if (!cur.rows.length) return;
      const next: ReviewStatus = (cur.rows[0].status as string) === 'resolved' ? 'open' : 'resolved';
      await db.execute({ sql: 'UPDATE reviews SET status = ?, resolved = ? WHERE id = ?', args: [next, next === 'resolved' ? 1 : 0, id] });
    },
    async addNote(id, note: ReviewNoteRecord) {
      // Atomic INSERT: concurrent appends serialize at the database, no read-modify-write.
      const exists = await db.execute({ sql: 'SELECT 1 FROM reviews WHERE id = ?', args: [id] });
      if (!exists.rows.length) return;
      await db.execute({
        sql: `INSERT INTO wak_notes (id, review_id, author_id, author, author_color, text, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [note.id, id, note.authorId ?? null, note.author, note.authorColor, note.text, note.createdAt],
      });
    },
    async delete(id) {
      const row = await db.execute({ sql: 'SELECT screenshot_url FROM reviews WHERE id = ?', args: [id] });
      const url = row.rows[0] ? ((row.rows[0].screenshot_url as string | null) ?? null) : null;
      await db.execute({ sql: 'DELETE FROM wak_notes WHERE review_id = ?', args: [id] });
      await db.execute({ sql: 'DELETE FROM reviews WHERE id = ?', args: [id] });
      return url;
    },
  };

  const users: UserStorage = {
    async list() {
      const r = await db.execute('SELECT * FROM wak_users ORDER BY name COLLATE NOCASE ASC');
      return r.rows.map(rowToUser);
    },
    async findByPassword(password) {
      // Kept for back-compat; not on the hot path since 0.3.4 (login is keyed by id).
      const r = await db.execute('SELECT * FROM wak_users');
      for (const row of r.rows) {
        const u = rowToUser(row);
        if (await verifyPassword(password, u.passwordHash)) return u;
      }
      return null;
    },
    async findById(id) {
      const r = await db.execute({ sql: 'SELECT * FROM wak_users WHERE id = ?', args: [id] });
      return r.rows[0] ? rowToUser(r.rows[0]) : null;
    },
    async insert(record) {
      await db.execute({
        sql: `INSERT INTO wak_users (id, name, password_hash, color, role, department_id, session_version, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          record.id, record.name, record.passwordHash, record.color, record.role,
          record.departmentId, record.sessionVersion ?? 1, record.createdAt,
        ],
      });
    },
    async update(id, patch) {
      const fields: string[] = [];
      const args: unknown[] = [];
      const map: Record<string, string> = {
        name: 'name', passwordHash: 'password_hash', color: 'color', role: 'role',
        departmentId: 'department_id', sessionVersion: 'session_version',
      };
      for (const k of Object.keys(patch) as Array<keyof typeof patch>) {
        const col = map[k as string];
        if (!col) continue;
        fields.push(`${col} = ?`);
        args.push(patch[k] ?? null);
      }
      if (!fields.length) return;
      args.push(id);
      await db.execute({ sql: `UPDATE wak_users SET ${fields.join(', ')} WHERE id = ?`, args });
    },
    async delete(id) { await db.execute({ sql: 'DELETE FROM wak_users WHERE id = ?', args: [id] }); },
    async count() {
      const r = await db.execute('SELECT COUNT(*) AS c FROM wak_users');
      return Number(r.rows[0]?.c ?? 0);
    },
    async updateUnlessLastAdmin(id, patch) {
      const map: Record<string, string> = {
        name: 'name', passwordHash: 'password_hash', color: 'color', role: 'role',
        departmentId: 'department_id', sessionVersion: 'session_version',
      };
      const fields: string[] = [];
      const args: unknown[] = [];
      for (const k of Object.keys(patch) as Array<keyof typeof patch>) {
        const col = map[k as string];
        if (!col) continue;
        fields.push(`${col} = ?`);
        args.push(patch[k] ?? null);
      }
      if (!fields.length) return true;
      const wantedRole = patch.role ?? null;

      // Single-statement guard: the UPDATE only fires when either:
      //   (a) we are not changing the role away from 'admin', or
      //   (b) the role isn't currently 'admin', or
      //   (c) at least one OTHER admin still exists.
      // Without a read-then-write window, two concurrent demote requests can't
      // both pass the check.
      const sql = `UPDATE wak_users SET ${fields.join(', ')} WHERE id = ? AND (
        ? IS NULL
        OR ? = 'admin'
        OR role != 'admin'
        OR (SELECT COUNT(*) FROM wak_users WHERE role = 'admin' AND id != ?) > 0
      )`;
      const r = await db.execute({ sql, args: [...args, id, wantedRole, wantedRole, id] }) as unknown as { rowsAffected?: number };
      return (r.rowsAffected ?? 0) > 0;
    },
    async deleteUnlessLastAdmin(id) {
      const sql = `DELETE FROM wak_users WHERE id = ? AND (
        role != 'admin'
        OR (SELECT COUNT(*) FROM wak_users WHERE role = 'admin' AND id != ?) > 0
      )`;
      const r = await db.execute({ sql, args: [id, id] }) as unknown as { rowsAffected?: number };
      return (r.rowsAffected ?? 0) > 0;
    },
  };

  const departments: DepartmentStorage = {
    async list() {
      const r = await db.execute('SELECT * FROM wak_departments ORDER BY name COLLATE NOCASE ASC');
      return r.rows.map(rowToDept);
    },
    async upsert(record) {
      await db.execute({
        sql: `INSERT INTO wak_departments (id, name, color) VALUES (?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color`,
        args: [record.id, record.name, record.color],
      });
    },
    async delete(id) { await db.execute({ sql: 'DELETE FROM wak_departments WHERE id = ?', args: [id] }); },
    async count() {
      const r = await db.execute('SELECT COUNT(*) AS c FROM wak_departments');
      return Number(r.rows[0]?.c ?? 0);
    },
  };

  return { reviews, users, departments };
}
