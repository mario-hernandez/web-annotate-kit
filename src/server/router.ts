import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword, publicUser, signSession, verifyPassword, verifySession } from './auth.js';
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
  /**
   * Path the router is mounted at on the host app (without trailing slash).
   * Used when constructing screenshot URLs that resolve through the authenticated
   * GET /screenshots/:file handler. Default: '/api'.
   * Example: if you mount with `app.use('/api/v2', createReviewRouter(...))` set this to `/api/v2`.
   */
  routerMountPath?: string;
  /** Absolute path to the directory where screenshots PNGs are written. */
  screenshotsDir: string;
  /** Express instance from the host app (pass `express` after `import express from 'express'`). */
  express: ExpressLike;
  /** Max size of JSON body (default "5mb"). Screenshots arrive base64-encoded. */
  jsonLimit?: string;
  /**
   * Optional mirror config for dev environments — pull-through + write-through
   * of screenshots to a remote (typically prod) instance.
   *
   * Uses a dedicated service-to-service key (`mirrorKey`) authenticated via the
   * `X-Mirror-Key` header against /mirror/screenshots endpoints. Separate from
   * the user-facing `apiKey` and `sessionSecret` so a leaked mirror key only
   * exposes the mirror surface, not user sessions or admin routes.
   *
   * Set `mirrorKey` on BOTH the dev (caller) and prod (callee) instances —
   * they must match. Treat it as a long random secret.
   */
  mirror?: {
    /** Remote base URL, including scheme and host. e.g. "https://staging.example.com" */
    baseUrl: string;
    /** Path prefix the remote router is mounted at. Default: '/api'. */
    routerMountPath?: string;
    /** Shared secret sent as `X-Mirror-Key`. Must match the remote's `mirrorKey`. */
    mirrorKey: string;
    timeoutMs?: number;
  };
  /**
   * If set, this server accepts inbound mirror traffic on /mirror/screenshots
   * authenticated by `X-Mirror-Key`. Required on the receiving side of a mirror
   * pair. Must NOT equal `apiKey` or `sessionSecret` (separate trust scope).
   */
  mirrorKey?: string;
  /** Optional hook called right after a successful insert. */
  onInsert?: (record: ReviewRecord) => void | Promise<void>;
}

/**
 * Seed users + departments into storage on first boot. By default this is a
 * "first-run-only" operation: if the corresponding table already has any rows,
 * it is left alone. That way an admin who deletes a seeded user (e.g. one whose
 * password leaked) doesn't see them resurrected on the next restart, and
 * department edits are not overwritten by code on every boot.
 *
 * Set `opts.force = true` to upsert/insert-if-missing on every call regardless
 * of existing rows — useful for tests, fixture rebuilds, or bootstrap CLIs.
 *
 * Concurrency: when seeding does run on an empty table, each insert uses
 * INSERT OR IGNORE so two instances booting against the same fresh DB will
 * both complete cleanly and the row count stays correct.
 *
 * `seededUsers` and `seededDepartments` count rows this call actually wrote.
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
  opts: { force?: boolean } = {},
): Promise<{ seededUsers: number; seededDepartments: number }> {
  let seededUsers = 0;
  let seededDepartments = 0;

  if (data.departments?.length) {
    const existing = await storage.departments.list();
    if (opts.force || existing.length === 0) {
      const beforeIds = new Set(existing.map((d) => d.id));
      for (const d of data.departments) {
        await storage.departments.upsert(d);
        if (!beforeIds.has(d.id)) seededDepartments++;
      }
    }
  }
  if (data.users?.length) {
    const userCount = await storage.users.count();
    if (opts.force || userCount === 0) {
      const now = new Date().toISOString();
      for (const u of data.users) {
        const created = await storage.users.insertIfNotExists({
          id: u.id,
          name: u.name,
          passwordHash: hashPassword(u.password),
          color: u.color,
          role: u.role,
          departmentId: u.departmentId ?? null,
          sessionVersion: 1,
          createdAt: now,
        });
        if (created) seededUsers++;
      }
    }
  }
  return { seededUsers, seededDepartments };
}

/* ─── Router ───────────────────────────────────────────────── */

export function createReviewRouter(opts: CreateReviewRouterOptions): RouterLike {
  const {
    storage, apiKey, screenshotsDir, express,
    jsonLimit = '5mb', mirror, mirrorKey, onInsert,
    sessionSecret,
    sessionTtlDays = 7,
    cookieName = 'wak_session',
    cookieSecure = false,
    routerMountPath = '/api',
  } = opts;
  // Normalize: strip trailing slash; ensure leading slash.
  const mountPath = routerMountPath.replace(/\/+$/, '') || '';

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
  if (mirrorKey && (mirrorKey === apiKey || mirrorKey === sessionSecret)) {
    throw new Error(
      "web-annotate-kit: `mirrorKey` must be distinct from `apiKey` and `sessionSecret`. " +
      "Each secret has a different blast radius if leaked.",
    );
  }
  if (mirrorKey && mirrorKey.length < 16) {
    throw new Error("web-annotate-kit: `mirrorKey` must be at least 16 chars.");
  }

  if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

  // One-shot migrations on first boot of this version. All idempotent.
  void (async () => {
    try {
      const all = await storage.reviews.list();

      // (a) Rewrite legacy screenshot URLs (`/screenshots/...` → `${mountPath}/screenshots/...`).
      for (const r of all) {
        if (r.screenshotUrl && r.screenshotUrl.startsWith('/screenshots/')) {
          await storage.reviews.updateScreenshot(r.id, `${mountPath}${r.screenshotUrl}`);
        }
      }

      // (b) Backfill author_id on legacy rows (created before v0.3 had stable ids).
      // Only fill when there is exactly one user with that display name; ambiguous
      // matches stay null so name collisions don't hand ownership to the wrong account.
      const users = await storage.users.list();
      const usersByName = new Map<string, string>(); // name → id (when unique)
      const nameCounts = new Map<string, number>();
      for (const u of users) {
        nameCounts.set(u.name, (nameCounts.get(u.name) ?? 0) + 1);
      }
      for (const u of users) {
        if (nameCounts.get(u.name) === 1) usersByName.set(u.name, u.id);
      }
      for (const r of all) {
        if (!r.authorId && usersByName.has(r.author)) {
          // Best-effort: storage adapters may omit setAuthorId. If absent, the
          // legacy row stays ownerless (only director/admin can act on it).
          await storage.reviews.setAuthorId?.(r.id, usersByName.get(r.author)!);
        }
      }
    } catch (e) {
      console.warn('[web-annotate-kit] startup migration failed:', (e as Error).message);
    }
  })();

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
      const { id, password } = (req.body ?? {}) as { id?: string; password?: string };
      if (!id || !password || typeof id !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Missing id or password' });
      }
      // Per-id + per-IP rate limit. Throttles brute-force attempts without
      // affecting legitimate users on other accounts.
      // We trust `req.ip` only — it's what Express resolves AFTER the host
      // configures `app.set('trust proxy', ...)`. Reading raw X-Forwarded-For
      // here would let an attacker rotate the header to evade the lock.
      // Behind a load balancer, the host MUST configure trust proxy so req.ip
      // reflects the real client; otherwise everything coalesces under the LB IP
      // (still safe — just throttles the proxy as one client).
      const ip = (req as unknown as { ip?: string }).ip || 'unknown';
      const rlKey = `${id.trim()}::${ip}`;
      if (loginIsLocked(rlKey)) {
        return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
      }
      const user = await storage.users.findById(id.trim());
      // Always run verifyPassword (against a dummy hash if user is missing) so timing
      // doesn't leak which ids exist in the table.
      const candidateHash = user?.passwordHash ?? DUMMY_HASH;
      const ok = (await verifyPassword(password.trim(), candidateHash)) && !!user;
      if (!ok) {
        recordLoginFailure(rlKey);
        return res.status(401).json({ error: 'Wrong id or password' });
      }
      clearLoginFailures(rlKey);
      const token = signSession(
        { uid: user!.id, role: user!.role, sv: user!.sessionVersion },
        sessionSecret, sessionTtlMs,
      );
      setSessionCookie(res, token);
      res.json({ user: publicUser(user!) });
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
          // Strict allow-list: must point at the authenticated router endpoint.
          // Blocks javascript:, data: and arbitrary URLs that would XSS via <a href>.
          // Accept legacy /screenshots/... too — older clients still send that shape;
          // the migration on boot rewrites stored values to /api/screenshots/.
          const expected = new RegExp(
            `^(${mountPath.replace(/[/.\\^$*+?()[\\]{}|]/g, '\\$&')}|)/screenshots/[a-zA-Z0-9_-]+\\.png$`,
          );
          if (!expected.test(url)) {
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

      // URL resolves through the AUTHENTICATED router endpoint, not a public static mount.
      const url = `${mountPath}/screenshots/${filename}`;
      res.json({ url });

      if (mirror) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), mirror.timeoutMs ?? 5000);
        const remoteMount = (mirror.routerMountPath ?? '/api').replace(/\/+$/, '');
        // Service-to-service: hit the dedicated mirror endpoint authenticated by
        // X-Mirror-Key. We do NOT reuse the user-facing POST /screenshots which
        // requires a session cookie this server doesn't have.
        fetch(`${mirror.baseUrl}${remoteMount}/mirror/screenshots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Mirror-Key': mirror.mirrorKey },
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
      // Match both the v0.3.4+ canonical URL and the legacy /screenshots/ form.
      const candidates = [`${mountPath}/screenshots/${filename}`, `/screenshots/${filename}`];
      const target = (await storage.reviews.list()).find((r) => r.screenshotUrl && candidates.includes(r.screenshotUrl));
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

  /* ─────────────────────────────────────────────────────── */
  /* Mirror — service-to-service (only when mirrorKey is set) */
  /* ─────────────────────────────────────────────────────── */

  if (mirrorKey) {
    const requireMirrorKey: HandlerLike = (req, res, next) => {
      const got = req.headers['x-mirror-key'];
      // Strict equality: timing-safe-ish (string compare on a tiny header is fine here).
      if (typeof got !== 'string' || got !== mirrorKey) {
        return res.status(401).json({ error: 'Mirror auth required' });
      }
      next?.();
    };

    // Inbound write-through: a peer (typically dev) pushes a captured screenshot
    // here so it lives on this filesystem too. No session cookie involved.
    router.post('/mirror/screenshots', requireMirrorKey, (req, res) => {
      try {
        const { id, image } = req.body as { id?: string; image?: string };
        if (!id || !image) return res.status(400).json({ error: 'Missing id or image' });
        if (!image.startsWith('data:image/png;base64,')) return res.status(400).json({ error: 'Invalid image format' });
        const filename = safeFilename(id);
        const filepath = join(screenshotsDir, filename);
        const base64Data = image.replace(/^data:image\/png;base64,/, '');
        writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
        res.json({ url: `${mountPath}/screenshots/${filename}` });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    // Inbound pull-through: a peer asks for a file we may have. We do NOT consult
    // the comments table here — the mirror channel is for raw PNGs and the
    // requesting peer has already decided it needs this file. The X-Mirror-Key
    // is the only authorization gate.
    router.get('/mirror/screenshots/:file', requireMirrorKey, (req, res) => {
      const filename = basename(req.params.file);
      if (!/^[a-zA-Z0-9_-]+\.png$/.test(filename)) return res.status(400).end();
      const filepath = join(screenshotsDir, filename);
      if (existsSync(filepath)) return res.sendFile(filepath);
      return res.status(404).end();
    });
  }

  router.get('/screenshots/:file', requireSession, async (req, res) => {
    const filename = basename(req.params.file);
    if (!/^[a-zA-Z0-9_-]+\.png$/.test(filename)) return res.status(400).end();
    const filepath = join(screenshotsDir, filename);
    if (existsSync(filepath)) return res.sendFile(filepath);

    if (mirror) {
      try {
        const remoteMount = (mirror.routerMountPath ?? '/api').replace(/\/+$/, '');
        const r = await fetch(`${mirror.baseUrl}${remoteMount}/mirror/screenshots/${filename}`, {
          headers: { 'X-Mirror-Key': mirror.mirrorKey },
        });
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
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      // Login is now keyed by id, so passwords don't need to be unique. The id itself
      // is the unique identifier — the storage layer rejects duplicates via PRIMARY KEY.
      try {
        await storage.users.insert({
          id, name, passwordHash: hashPassword(password),
          color: color ?? '#6B7280', role, departmentId: departmentId ?? null,
          sessionVersion: 1,
          createdAt: new Date().toISOString(),
        });
      } catch (e) {
        const msg = String((e as Error).message || '');
        if (/UNIQUE|PRIMARY|already exists/i.test(msg)) {
          return res.status(409).json({ error: `User id "${id}" already exists` });
        }
        throw e;
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
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        patch.passwordHash = hashPassword(password);
        // Invalidate every active session for this user. If the admin reset the code
        // because it leaked, any existing browser cookie must stop working immediately.
        const current = await storage.users.findById(id);
        patch.sessionVersion = (current?.sessionVersion ?? 1) + 1;
      }

      // Apply atomically with the last-admin invariant baked into the storage call.
      const ok = await storage.users.updateUnlessLastAdmin(id, patch);
      if (!ok) return res.status(400).json({ error: 'Cannot demote the last admin (or user not found)' });

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

/* ─── Login rate limit (per id + IP, in-memory) ───────────── */

interface LoginRl { failures: number; lockedUntil: number }
const loginRl = new Map<string, LoginRl>();
const LOGIN_DELAYS_S = [0, 0, 0, 5, 15, 60, 300, 900];

function loginIsLocked(key: string): boolean {
  const r = loginRl.get(key);
  return !!r && r.lockedUntil > Date.now();
}
function recordLoginFailure(key: string) {
  const r = loginRl.get(key) ?? { failures: 0, lockedUntil: 0 };
  r.failures += 1;
  const idx = Math.min(r.failures, LOGIN_DELAYS_S.length - 1);
  const sec = LOGIN_DELAYS_S[idx];
  r.lockedUntil = sec > 0 ? Date.now() + sec * 1000 : 0;
  loginRl.set(key, r);
  // Garbage-collect old entries occasionally so the map doesn't grow without bound.
  if (loginRl.size > 1000) {
    const now = Date.now();
    for (const [k, v] of loginRl) {
      if (v.lockedUntil === 0 || v.lockedUntil < now - 3_600_000) loginRl.delete(k);
    }
  }
}
function clearLoginFailures(key: string) { loginRl.delete(key); }

/**
 * Pre-computed hash of an unguessable string. Used as a target when the supplied
 * id doesn't exist, so verifyPassword spends comparable time and the response
 * latency doesn't leak which ids are in the user table.
 */
const DUMMY_HASH = hashPassword('::wak-dummy-password-do-not-use::');
