import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword, publicUser, signSession, verifySession } from './auth.js';
import { canActOnComment, canManageOrg, type ReviewAction } from './permissions.js';
import type {
  DepartmentRecord, DepartmentStorage,
  ReviewRecord, ReviewStorage,
  UserRecord, UserStorage,
} from './storage/types.js';

/* ─── Loose Express types (avoids forcing @types/express on consumers) ── */

interface ExpressLike {
  Router(): RouterLike;
  static(path: string): MiddlewareLike;
  json(opts?: { limit?: string }): MiddlewareLike;
}
interface RouterLike {
  get(path: string, ...handlers: HandlerLike[]): RouterLike;
  post(path: string, ...handlers: HandlerLike[]): RouterLike;
  patch(path: string, ...handlers: HandlerLike[]): RouterLike;
  delete(path: string, ...handlers: HandlerLike[]): RouterLike;
  use(...args: unknown[]): RouterLike;
}
type HandlerLike = (req: RequestLike, res: ResponseLike, next?: () => void) => void | Promise<void>;
type MiddlewareLike = HandlerLike;
interface RequestLike {
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  path: string;
  params: Record<string, string>;
  // populated by our session middleware
  wakUser?: UserRecord;
}
interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
  end(): void;
  sendFile(path: string): void;
  type(type: string): ResponseLike;
  send(body: unknown): void;
  setHeader(name: string, value: string | string[]): void;
}

/* ─── Public API ───────────────────────────────────────────── */

export interface CreateReviewRouterOptions {
  storage: {
    reviews: ReviewStorage;
    users: UserStorage;
    departments: DepartmentStorage;
  };
  /** Shared secret required on the login endpoint via `X-API-Key` header. Also used for bootstrap. */
  apiKey: string;
  /**
   * Secret used to sign session cookies (HMAC-SHA256). REQUIRED.
   * Must NOT equal `apiKey` — `apiKey` ships in the client bundle and is therefore
   * publicly readable; reusing it would let any visitor mint forged session cookies.
   * Use a long random string from your secret manager / env.
   */
  sessionSecret: string;
  /** Session TTL in days. Default: 7. */
  sessionTtlDays?: number;
  /** Cookie name. Default: 'wak_session'. */
  cookieName?: string;
  /** Set `Secure` flag on the session cookie. Default: false. Set true behind HTTPS in production. */
  cookieSecure?: boolean;
  /** Absolute path to the directory where screenshots PNGs are written. */
  screenshotsDir: string;
  /** Express instance from the host app (pass `express` after `import express from 'express'`). */
  express: ExpressLike;
  /** Max size of JSON body (default "5mb"). Screenshots arrive base64-encoded. */
  jsonLimit?: string;
  /** Optional mirror config for dev environments — pull-through + write-through to prod. */
  mirror?: { baseUrl: string; apiKey: string; timeoutMs?: number };
  /** Optional hook called right after a successful insert. */
  onInsert?: (record: ReviewRecord) => void | Promise<void>;
}

/**
 * Seed users + departments into storage iff both tables are empty. Idempotent.
 * Call this once during host-app boot to bootstrap a fresh DB.
 */
export async function seedIfEmpty(
  storage: { users: UserStorage; departments: DepartmentStorage },
  data: {
    departments?: DepartmentRecord[];
    users?: Array<{
      id: string; name: string; password: string; color: string;
      role: UserRecord['role']; departmentId?: string | null;
    }>;
  },
): Promise<{ seededUsers: number; seededDepartments: number }> {
  const [uCount, dCount] = await Promise.all([storage.users.count(), storage.departments.count()]);
  let seededUsers = 0;
  let seededDepartments = 0;

  if (dCount === 0 && data.departments?.length) {
    for (const d of data.departments) {
      await storage.departments.upsert(d);
      seededDepartments++;
    }
  }
  if (uCount === 0 && data.users?.length) {
    const now = new Date().toISOString();
    for (const u of data.users) {
      await storage.users.insert({
        id: u.id,
        name: u.name,
        passwordHash: hashPassword(u.password),
        color: u.color,
        role: u.role,
        departmentId: u.departmentId ?? null,
        sessionVersion: 1,
        createdAt: now,
      });
      seededUsers++;
    }
  }
  return { seededUsers, seededDepartments };
}

/* ─── Router ───────────────────────────────────────────────── */

export function createReviewRouter(opts: CreateReviewRouterOptions): RouterLike {
  const {
    storage, apiKey, screenshotsDir, express,
    jsonLimit = '5mb', mirror, onInsert,
    sessionSecret,
    sessionTtlDays = 7,
    cookieName = 'wak_session',
    cookieSecure = false,
  } = opts;

  if (!sessionSecret || typeof sessionSecret !== 'string' || sessionSecret.length < 16) {
    throw new Error(
      "web-annotate-kit: createReviewRouter requires a strong `sessionSecret` (>= 16 chars). " +
      "It must NOT equal `apiKey` (which ships in the client bundle). " +
      "Generate one with `openssl rand -hex 32` and store it in your env.",
    );
  }
  if (sessionSecret === apiKey) {
    throw new Error(
      "web-annotate-kit: `sessionSecret` must NOT equal `apiKey`. " +
      "`apiKey` is publicly readable from the client bundle; reusing it lets anyone forge sessions.",
    );
  }

  if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

  const router = express.Router();
  const sessionTtlMs = sessionTtlDays * 86400000;

  /* ── Helpers ─────────────────────────────────────────── */

  const safeFilename = (id: string) => basename(id).replace(/[^a-zA-Z0-9_-]/g, '') + '.png';

  const deleteScreenshotFile = (url: string | null) => {
    if (!url) return;
    try {
      const filename = safeFilename(url.split('/').pop()!.replace('.png', ''));
      const filepath = join(screenshotsDir, filename);
      if (existsSync(filepath)) unlinkSync(filepath);
    } catch { /* ignore */ }
  };

  const parseCookies = (header: string | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (!k) continue;
      out[k] = decodeURIComponent(rest.join('=') || '');
    }
    return out;
  };

  const setSessionCookie = (res: ResponseLike, token: string) => {
    const parts = [
      `${cookieName}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
    ];
    if (cookieSecure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  };

  const clearSessionCookie = (res: ResponseLike) => {
    const parts = [`${cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (cookieSecure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  };

  /* ── Middleware ──────────────────────────────────────── */

  const requireApiKey: HandlerLike = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (key !== apiKey) return res.status(401).json({ error: 'Unauthorized' });
    next?.();
  };

  const requireSession: HandlerLike = async (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie as string | undefined);
    const token = cookies[cookieName];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const payload = verifySession(token, sessionSecret);
    if (!payload) return res.status(401).json({ error: 'Session expired or invalid' });
    const user = await storage.users.findById(payload.uid);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    // Revocation check: if the user's password was changed (sessionVersion bumped),
    // older cookies are immediately invalid even if their HMAC is still good.
    if (payload.sv !== user.sessionVersion) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Session revoked' });
    }
    req.wakUser = user;
    next?.();
  };

  const requireAdmin: HandlerLike = (req, res, next) => {
    if (!req.wakUser || !canManageOrg(req.wakUser)) return res.status(403).json({ error: 'Admin only' });
    next?.();
  };

  router.use(express.json({ limit: jsonLimit }));

  /* ─────────────────────────────────────────────────────── */
  /* Auth                                                    */
  /* ─────────────────────────────────────────────────────── */

  router.post('/auth/login', requireApiKey, async (req, res) => {
    try {
      const { password } = (req.body ?? {}) as { password?: string };
      if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Missing password' });
      const user = await storage.users.findByPassword(password.trim());
      if (!user) return res.status(401).json({ error: 'Wrong password' });
      const token = signSession(
        { uid: user.id, role: user.role, sv: user.sessionVersion },
        sessionSecret, sessionTtlMs,
      );
      setSessionCookie(res, token);
      res.json({ user: publicUser(user) });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/auth/me', requireSession, (req, res) => {
    res.json({ user: publicUser(req.wakUser!) });
  });

  /* ─────────────────────────────────────────────────────── */
  /* Reviews                                                 */
  /* ─────────────────────────────────────────────────────── */

  router.get('/reviews', requireSession, async (_req, res) => {
    try {
      const all = await storage.reviews.list();
      res.json(all);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/reviews', requireSession, async (req, res) => {
    const { action, data } = (req.body ?? {}) as { action?: string; data?: Record<string, unknown> };
    if (!action || !data) return res.status(400).json({ error: 'Missing action or data' });
    const me = req.wakUser!;

    try {
      switch (action) {
        case 'add': {
          // Authorship is enforced server-side: the author is the session user.
          const record: ReviewRecord = {
            id: String(data.id),
            authorId: me.id,
            author: me.name,
            authorColor: me.color,
            page: String(data.page),
            x: Number(data.x),
            y: Number(data.y),
            text: String(data.text),
            createdAt: new Date().toISOString(),
            updatedAt: null,
            status: 'open',
            resolved: false,
            department: (data.department as string) || 'general',
            notes: [],
            acceptedAt: null,
            acceptedBy: null,
            acceptedById: null,
            section: (data.section as string) ?? null,
            nearestText: (data.nearestText as string) ?? null,
            selector: (data.selector as string) ?? null,
            tagName: (data.tagName as string) ?? null,
            screenshotUrl: null,
          };
          await storage.reviews.insert(record);
          if (onInsert) await onInsert(record);
          break;
        }
        case 'update': {
          const id = String(data.id);
          const target = (await storage.reviews.list()).find((r) => r.id === id);
          if (!target) return res.status(404).json({ error: 'Comment not found' });
          if (!canActOnComment(me, 'edit', target)) return res.status(403).json({ error: 'Not allowed' });
          await storage.reviews.updateText(id, String(data.text), new Date().toISOString());
          break;
        }
        case 'update-screenshot': {
          const id = String(data.id);
          const url = String(data.screenshotUrl ?? '');
          // Strict allow-list: only same-origin /screenshots/<safe>.png URLs.
          // Blocks javascript:, data: and arbitrary URLs that would XSS via <a href>.
          if (!/^\/screenshots\/[a-zA-Z0-9_-]+\.png$/.test(url)) {
            return res.status(400).json({ error: 'Invalid screenshot URL' });
          }
          const target = (await storage.reviews.list()).find((r) => r.id === id);
          if (!target) return res.status(404).json({ error: 'Comment not found' });
          if (!canActOnComment(me, 'edit', target)) return res.status(403).json({ error: 'Not allowed' });
          await storage.reviews.updateScreenshot(id, url);
          break;
        }
        case 'resolve': {
          const id = String(data.id);
          const target = (await storage.reviews.list()).find((r) => r.id === id);
          if (!target) return res.status(404).json({ error: 'Comment not found' });
          if (target.status === 'resolved') {
            // Reopen path: resolved → open. Strips acceptance metadata so it must be re-accepted.
            if (!canActOnComment(me, 'reopen', target)) return res.status(403).json({ error: 'Not allowed' });
            await storage.reviews.setStatus(id, 'open');
          } else {
            // Strict gate: only `accepted` comments can be resolved.
            if (target.status !== 'accepted') {
              return res.status(409).json({ error: "Comment must be accepted by a lead before it can be resolved." });
            }
            if (!canActOnComment(me, 'resolve', target)) return res.status(403).json({ error: 'Not allowed' });
            await storage.reviews.setStatus(id, 'resolved');
          }
          break;
        }
        case 'accept': {
          const id = String(data.id);
          const target = (await storage.reviews.list()).find((r) => r.id === id);
          if (!target) return res.status(404).json({ error: 'Comment not found' });
          if (!canActOnComment(me, 'accept', target)) return res.status(403).json({ error: 'Not allowed' });
          await storage.reviews.setStatus(id, 'accepted', {
            acceptedBy: me.name,
            acceptedById: me.id,
            acceptedAt: new Date().toISOString(),
          });
          break;
        }
        case 'add-note': {
          const id = String(data.id);
          const text = String(data.text || '').trim();
          if (!text) return res.status(400).json({ error: 'Empty note' });
          // Validate the parent exists so we don't silently drop notes.
          const target = (await storage.reviews.list()).find((r) => r.id === id);
          if (!target) return res.status(404).json({ error: 'Comment not found' });
          await storage.reviews.addNote(id, {
            id: cryptoRandomId(),
            authorId: me.id,
            author: me.name,
            authorColor: me.color,
            text,
            createdAt: new Date().toISOString(),
          });
          break;
        }
        case 'delete': {
          const id = String(data.id);
          const target = (await storage.reviews.list()).find((r) => r.id === id);
          if (!target) return res.status(404).json({ error: 'Comment not found' });
          if (!canActOnComment(me, 'delete', target)) return res.status(403).json({ error: 'Not allowed' });
          const url = await storage.reviews.delete(id);
          deleteScreenshotFile(url);
          break;
        }
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }

      const all = await storage.reviews.list();
      res.json(all);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /* ─────────────────────────────────────────────────────── */
  /* Screenshots                                             */
  /* ─────────────────────────────────────────────────────── */

  router.post('/screenshots', requireSession, async (req, res) => {
    try {
      const me = req.wakUser!;
      const { id, image } = req.body as { id?: string; image?: string };
      if (!id || !image) return res.status(400).json({ error: 'Missing id or image' });
      if (!image.startsWith('data:image/png;base64,')) return res.status(400).json({ error: 'Invalid image format' });

      // The screenshot is keyed by the parent comment id. Authorize against that comment.
      const target = (await storage.reviews.list()).find((r) => r.id === id);
      if (!target) return res.status(404).json({ error: 'Comment not found' });
      if (!canActOnComment(me, 'edit', target)) return res.status(403).json({ error: 'Not allowed' });

      const filename = safeFilename(id);
      const filepath = join(screenshotsDir, filename);
      const base64Data = image.replace(/^data:image\/png;base64,/, '');
      writeFileSync(filepath, Buffer.from(base64Data, 'base64'));

      const url = `/screenshots/${filename}`;
      res.json({ url });

      if (mirror) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), mirror.timeoutMs ?? 5000);
        fetch(`${mirror.baseUrl}/api/screenshots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': mirror.apiKey },
          body: JSON.stringify({ id, image }),
          signal: ac.signal,
        })
          .catch((e: Error) => console.warn(`[web-annotate-kit] mirror upload failed: ${e.message}`))
          .finally(() => clearTimeout(t));
      }
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.delete('/screenshots/:file', requireSession, async (req, res) => {
    try {
      const me = req.wakUser!;
      const filename = safeFilename(basename(req.params.file).replace(/\.png$/i, ''));
      const targetUrl = `/screenshots/${filename}`;
      // Find the review that owns this screenshot. If none → 404 (don't let admins
      // wander the filesystem; screenshots only exist in relation to a comment).
      const target = (await storage.reviews.list()).find((r) => r.screenshotUrl === targetUrl);
      if (!target) return res.status(404).json({ error: 'Screenshot not linked to any comment' });
      if (!canActOnComment(me, 'edit', target) && !canActOnComment(me, 'delete', target)) {
        return res.status(403).json({ error: 'Not allowed' });
      }
      const filepath = join(screenshotsDir, filename);
      if (existsSync(filepath)) unlinkSync(filepath);
      // Also clear the URL from the row so the UI doesn't render a broken image.
      await storage.reviews.updateScreenshot(target.id, null);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.get('/screenshots/:file', requireSession, async (req, res) => {
    const filename = basename(req.params.file);
    if (!/^[a-zA-Z0-9_-]+\.png$/.test(filename)) return res.status(400).end();
    const filepath = join(screenshotsDir, filename);
    if (existsSync(filepath)) return res.sendFile(filepath);

    if (mirror) {
      try {
        const r = await fetch(`${mirror.baseUrl}/screenshots/${filename}`);
        if (!r.ok) return res.status(404).end();
        const buf = Buffer.from(await r.arrayBuffer());
        writeFileSync(filepath, buf);
        return res.type('png').send(buf);
      } catch {
        return res.status(502).end();
      }
    }
    res.status(404).end();
  });

  /* ─────────────────────────────────────────────────────── */
  /* Departments (read public, write admin-only)             */
  /* ─────────────────────────────────────────────────────── */

  router.get('/departments', requireSession, async (_req, res) => {
    try {
      res.json(await storage.departments.list());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/departments', requireSession, requireAdmin, async (req, res) => {
    try {
      const { id, name, color } = req.body as Partial<DepartmentRecord>;
      if (!id || !name) return res.status(400).json({ error: 'id and name are required' });
      await storage.departments.upsert({ id: String(id), name: String(name), color: String(color ?? '#6B7280') });
      res.json(await storage.departments.list());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.delete('/departments/:id', requireSession, requireAdmin, async (req, res) => {
    try {
      await storage.departments.delete(String(req.params.id));
      res.json(await storage.departments.list());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /* ─────────────────────────────────────────────────────── */
  /* Users (admin-only)                                       */
  /* ─────────────────────────────────────────────────────── */

  router.get('/users', requireSession, requireAdmin, async (_req, res) => {
    try {
      const list = await storage.users.list();
      res.json(list.map(publicUser));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/users', requireSession, requireAdmin, async (req, res) => {
    try {
      const { id, name, password, color, role, departmentId } = req.body as {
        id?: string; name?: string; password?: string; color?: string;
        role?: UserRecord['role']; departmentId?: string | null;
      };
      if (!id || !name || !password || !role) return res.status(400).json({ error: 'id, name, password, role are required' });
      // Pre-check (cheap path); the post-check after insert catches concurrent races.
      const existing = await storage.users.findByPassword(password);
      if (existing) return res.status(409).json({ error: 'Access code already in use' });
      await storage.users.insert({
        id, name, passwordHash: hashPassword(password),
        color: color ?? '#6B7280', role, departmentId: departmentId ?? null,
        sessionVersion: 1,
        createdAt: new Date().toISOString(),
      });
      // Post-check: if a concurrent request committed the same code, undo our insert.
      // This closes the read-then-write race the adversarial review flagged.
      const after = await storage.users.findByPassword(password);
      if (after && after.id !== id) {
        await storage.users.delete(id);
        return res.status(409).json({ error: 'Access code collision detected — assign a different code' });
      }
      const all = await storage.users.list();
      res.json(all.map(publicUser));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.patch('/users/:id', requireSession, requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id);
      const { name, password, color, role, departmentId } = req.body as {
        name?: string; password?: string; color?: string;
        role?: UserRecord['role']; departmentId?: string | null;
      };

      const patch: Partial<Omit<UserRecord, 'id' | 'createdAt'>> = {};
      if (name !== undefined) patch.name = name;
      if (color !== undefined) patch.color = color;
      if (role !== undefined) patch.role = role;
      if (departmentId !== undefined) patch.departmentId = departmentId;
      if (password) {
        // Pre-check duplicates (cheap path); the post-check below catches concurrent races.
        const existing = await storage.users.findByPassword(password);
        if (existing && existing.id !== id) {
          return res.status(409).json({ error: 'Access code already in use' });
        }
        patch.passwordHash = hashPassword(password);
        // Invalidate every active session for this user. If the admin reset the code
        // because it leaked, any existing browser cookie must stop working immediately.
        const current = await storage.users.findById(id);
        patch.sessionVersion = (current?.sessionVersion ?? 1) + 1;
      }

      // Apply atomically with the last-admin invariant baked into the storage call.
      // Without this the original read-then-write check was raceable: two parallel
      // demote requests could both observe the other admin and both succeed.
      const ok = await storage.users.updateUnlessLastAdmin(id, patch);
      if (!ok) return res.status(400).json({ error: 'Cannot demote the last admin (or user not found)' });

      // Post-check: if someone else committed the same access code in parallel,
      // the pre-check above wouldn't have caught it. Detect now and roll back.
      if (password) {
        const after = await storage.users.findByPassword(password);
        if (after && after.id !== id) {
          // Roll back the password change. We don't have the old hash here, so
          // revert by stripping the password from this account: bump sessionVersion
          // again and set a random unguessable hash. The admin must re-issue a code.
          await storage.users.update(id, {
            passwordHash: hashPassword(randomBytes(32).toString('hex')),
            sessionVersion: (patch.sessionVersion ?? 1) + 1,
          });
          return res.status(409).json({ error: 'Access code collision detected — assign a different code' });
        }
      }

      const all = await storage.users.list();
      res.json(all.map(publicUser));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.delete('/users/:id', requireSession, requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id);
      const ok = await storage.users.deleteUnlessLastAdmin(id);
      if (!ok) return res.status(400).json({ error: 'Cannot delete the last admin (or user not found)' });
      const next = await storage.users.list();
      res.json(next.map(publicUser));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  return router;
}

function cryptoRandomId(): string {
  return randomBytes(8).toString('hex');
}
