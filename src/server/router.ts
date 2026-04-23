import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ReviewRecord, ReviewStorage } from './storage/types.js';

// Loose Express types so users don't need @types/express at consume time.
interface ExpressLike {
  Router(): RouterLike;
  static(path: string): MiddlewareLike;
  json(opts?: { limit?: string }): MiddlewareLike;
}
interface RouterLike {
  get(path: string, ...handlers: HandlerLike[]): RouterLike;
  post(path: string, ...handlers: HandlerLike[]): RouterLike;
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
}
interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
  end(): void;
  sendFile(path: string): void;
  type(type: string): ResponseLike;
  send(body: unknown): void;
}

export interface CreateReviewRouterOptions {
  /** Storage backend (sqlite, turso, memory, or custom). */
  storage: ReviewStorage;
  /** Shared secret required on POST endpoints via `X-API-Key` header. */
  apiKey: string;
  /** Absolute path to the directory where screenshots PNGs are written. */
  screenshotsDir: string;
  /** Express instance from the host app (pass `express` after `import express from 'express'`). */
  express: ExpressLike;
  /**
   * Max size of JSON body (default "5mb"). Screenshots arrive base64-encoded.
   */
  jsonLimit?: string;
  /**
   * Optional mirror config for dev environments. When set, POST /screenshots
   * will also forward the upload to `mirrorUrl`, and GET /screenshots/:id will
   * pull from `mirrorUrl` if the file is missing locally (pull-through cache).
   * Only enable in development — never on the origin itself.
   */
  mirror?: {
    baseUrl: string;          // e.g. "https://example.com"
    apiKey: string;           // the remote API_KEY
    timeoutMs?: number;       // default 5000
  };
  /**
   * Optional hook called right after a successful insert. Useful for logging, notifications.
   */
  onInsert?: (record: ReviewRecord) => void | Promise<void>;
}

/**
 * Create an Express Router exposing review + screenshot endpoints.
 *
 * Mount it wherever you want:
 *   app.use('/api', createReviewRouter({ storage, apiKey, screenshotsDir, express }));
 *
 * The router exposes:
 *   GET    /reviews          (public — list all reviews)
 *   POST   /reviews          (auth  — { action, data } CRUD dispatcher)
 *   POST   /screenshots      (auth  — { id, image (dataURL) })
 *   DELETE /screenshots/:id  (auth  — remove a screenshot file)
 *   GET    /screenshots/:id  (public — serves PNG, with optional pull-through)
 */
export function createReviewRouter(opts: CreateReviewRouterOptions): RouterLike {
  const { storage, apiKey, screenshotsDir, express, jsonLimit = '5mb', mirror, onInsert } = opts;

  if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

  const router = express.Router();

  const requireAuth: HandlerLike = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (key !== apiKey) return res.status(401).json({ error: 'Unauthorized' });
    next?.();
  };

  const safeFilename = (id: string) => basename(id).replace(/[^a-zA-Z0-9_-]/g, '') + '.png';

  const deleteScreenshotFile = (url: string | null) => {
    if (!url) return;
    try {
      const filename = safeFilename(url.split('/').pop()!.replace('.png', ''));
      const filepath = join(screenshotsDir, filename);
      if (existsSync(filepath)) unlinkSync(filepath);
    } catch {
      /* swallow */
    }
  };

  router.use(express.json({ limit: jsonLimit }));

  /* ── GET /reviews — list (public) ───────────────────────── */
  router.get('/reviews', async (_req, res) => {
    try {
      const all = await storage.list();
      res.json(all);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /* ── POST /reviews — CRUD dispatcher (auth) ────────────── */
  router.post('/reviews', requireAuth, async (req, res) => {
    const { action, data } = (req.body ?? {}) as { action?: string; data?: Record<string, unknown> };
    if (!action || !data) return res.status(400).json({ error: 'Missing action or data' });

    try {
      switch (action) {
        case 'add': {
          const record: ReviewRecord = {
            id: String(data.id),
            author: String(data.author),
            authorColor: (data.authorColor as string) ?? null,
            page: String(data.page),
            x: Number(data.x),
            y: Number(data.y),
            text: String(data.text),
            createdAt: String(data.createdAt),
            updatedAt: (data.updatedAt as string) ?? null,
            resolved: Boolean(data.resolved),
            section: (data.section as string) ?? null,
            nearestText: (data.nearestText as string) ?? null,
            selector: (data.selector as string) ?? null,
            tagName: (data.tagName as string) ?? null,
            screenshotUrl: (data.screenshotUrl as string) ?? null,
          };
          await storage.insert(record);
          if (onInsert) await onInsert(record);
          break;
        }
        case 'update':
          await storage.updateText(String(data.id), String(data.text), new Date().toISOString());
          break;
        case 'update-screenshot':
          await storage.updateScreenshot(String(data.id), String(data.screenshotUrl));
          break;
        case 'resolve':
          await storage.toggleResolved(String(data.id));
          break;
        case 'delete': {
          const url = await storage.delete(String(data.id));
          deleteScreenshotFile(url);
          break;
        }
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }

      const all = await storage.list();
      res.json(all);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /* ── POST /screenshots — upload PNG (auth) ─────────────── */
  router.post('/screenshots', requireAuth, async (req, res) => {
    try {
      const { id, image } = req.body as { id?: string; image?: string };
      if (!id || !image) return res.status(400).json({ error: 'Missing id or image' });
      if (!image.startsWith('data:image/png;base64,')) return res.status(400).json({ error: 'Invalid image format' });

      const filename = safeFilename(id);
      const filepath = join(screenshotsDir, filename);
      const base64Data = image.replace(/^data:image\/png;base64,/, '');
      writeFileSync(filepath, Buffer.from(base64Data, 'base64'));

      const url = `/screenshots/${filename}`;
      res.json({ url });

      // Fire-and-forget mirror (dev → prod). Errors only logged.
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

  /* ── DELETE /screenshots/:file — remove PNG (auth) ─────── */
  router.delete('/screenshots/:file', requireAuth, (req, res) => {
    const filename = safeFilename(basename(req.params.file).replace(/\.png$/i, ''));
    const filepath = join(screenshotsDir, filename);
    try {
      if (existsSync(filepath)) unlinkSync(filepath);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /* ── GET /screenshots/:file — serve PNG (public) ───────── */
  router.get('/screenshots/:file', async (req, res) => {
    const filename = basename(req.params.file);
    if (!/^[a-zA-Z0-9_-]+\.png$/.test(filename)) return res.status(400).end();
    const filepath = join(screenshotsDir, filename);

    if (existsSync(filepath)) return res.sendFile(filepath);

    // Pull-through from mirror if configured
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

  return router;
}

export { readFileSync }; // re-exported for rare consumer use
