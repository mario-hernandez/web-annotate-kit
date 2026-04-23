![web-annotate-kit — pin-anchored review comments on any website](docs/images/hero.png)

# web-annotate-kit

> Pin-anchored visual review on any live website. React + Express + pluggable storage.

Stop asking your team to **"send me a screenshot with a red circle by email"**. Let reviewers drop comments directly on the running site, at the exact pixel they care about, with an automatic screenshot attached.

Built for teams reviewing content, design and copy on staging/production websites — directors, content writers, designers — without making them learn Figma.

![MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![React 18+](https://img.shields.io/badge/react-%E2%89%A518-61DAFB?logo=react)
![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-5FA04E?logo=node.js)

---

## Features

- **Pin comments** anchored by percent-x + pixel-y so they stick even as the layout shifts.
- **Automatic screenshots** via the Screen Capture API — the reviewer clicks **Allow**, a red marker is drawn on the capture, done.
- **DOM context** captured with each comment: nearest `<section>` heading, enclosing tag, truncated text nearby, CSS selector path.
- **Dashboard view** aggregating every pin across every URL, filterable by author, page, status.
- **Export** to `.txt` (prompt-ready for LLM handoff) or `.json`.
- **Pluggable storage**: SQLite (zero-setup), Turso (hosted), or write your own adapter.
- **Rate-limited login** with exponential backoff stored in `localStorage`.
- **Framework-agnostic routing**: default tracks `window.location.pathname`; pass your router's pathname for perfect integration.

---

## Install

```bash
npm install web-annotate-kit
# Pick one backend
npm install better-sqlite3          # for SQLite storage
# or
npm install @libsql/client          # for Turso storage

# Peer deps (likely already installed)
npm install react react-dom express
```

---

## Quick start

### 1. Run the schema

Either call the adapter (it creates the table on first use) or apply `web-annotate-kit/schema.sql` manually. SQLite and Turso both work.

### 2. Mount the server router

```js
// server.js
import express from 'express';
import { createReviewRouter, sqliteStorage } from 'web-annotate-kit/server';

const app = express();
const storage = await sqliteStorage({ path: './reviews.db' });

app.use('/api', createReviewRouter({
  storage,
  apiKey: process.env.REVIEW_API_KEY,
  screenshotsDir: './screenshots',
  express,
}));

app.use('/screenshots', express.static('./screenshots'));
app.listen(3001);
```

### 3. Wrap your React app

```tsx
// main.tsx
import { ReviewProvider, ReviewOverlay, ReviewLogin, useReview } from 'web-annotate-kit/client';

function Gate({ children }) {
  const { user } = useReview();
  if (!user) return <ReviewLogin brand="Acme" />;
  return <>{children}<ReviewOverlay /></>;
}

<ReviewProvider
  apiKey={import.meta.env.VITE_REVIEW_API_KEY}
  users={[
    { id: 'alice', name: 'Alice', password: 'alice-pass', color: '#3B82F6', role: 'admin' },
    { id: 'bob',   name: 'Bob',   password: 'bob-pass',   color: '#10B981', role: 'reviewer' },
  ]}
>
  <Gate><YourApp /></Gate>
</ReviewProvider>
```

That's it. Alice can now log in at your site, click the **+** button at the bottom right, and drop a pin anywhere.

---

## The dashboard

![Dashboard — aggregated comments across all pages, filterable by reviewer / page / status](docs/images/dashboard.png)

A dedicated page at any path you choose (default `/review`) shows every comment across the site. Filter by reviewer, page, or status. Export to `.txt` (LLM-friendly — literally paste into Claude and ask for a plan) or `.json`.

```tsx
import { ReviewDashboard } from 'web-annotate-kit/client';

<Route path="/review" element={<ReviewDashboard title="Acme review" />} />
```

---

## Storage adapters

All three implement the same `ReviewStorage` interface. Pick one and pass it to `createReviewRouter`.

### SQLite (zero-setup, single machine)

```js
import { sqliteStorage } from 'web-annotate-kit/server';
const storage = await sqliteStorage({ path: './reviews.db' });
```

### Turso (hosted libsql, shared across machines)

```js
import { tursoStorage } from 'web-annotate-kit/server';
const storage = await tursoStorage({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

### In-memory (tests, demos only)

```js
import { memoryStorage } from 'web-annotate-kit/server';
const storage = memoryStorage();
```

### Custom

Implement the interface from `web-annotate-kit/server`:

```ts
interface ReviewStorage {
  list(): Promise<ReviewRecord[]>;
  insert(record: ReviewRecord): Promise<void>;
  updateText(id: string, text: string, updatedAt: string): Promise<void>;
  updateScreenshot(id: string, screenshotUrl: string): Promise<void>;
  toggleResolved(id: string): Promise<void>;
  delete(id: string): Promise<string | null>; // returns screenshot URL to clean up
}
```

Postgres, MySQL, DynamoDB, plain JSON file — all fair game.

---

## Architecture

![Architecture — React app → ReviewProvider → Express Router → Storage (SQLite / Turso / custom)](docs/images/architecture.png)

Screenshots are stored as PNG files on the server filesystem; only the URL is kept in the DB.

---

## Distributed setup (dev ↔ prod sync)

If your team comments on a live URL (e.g. `staging.example.com`) but you also run a local dev server against the same database, screenshots end up split between the two filesystems. The router has an optional `mirror` config that turns the dev server into a **pull-through cache** and **write-through mirror** to production.

```js
app.use('/api', createReviewRouter({
  storage,
  apiKey: process.env.REVIEW_API_KEY,
  screenshotsDir: './screenshots',
  express,
  mirror: process.env.NODE_ENV !== 'production' ? {
    baseUrl: 'https://staging.example.com',
    apiKey: process.env.REVIEW_API_KEY,
    timeoutMs: 5000,
  } : undefined,
}));
```

- Uploads on dev → also POSTed to prod (fire-and-forget, 5s timeout).
- Misses on `GET /screenshots/:id` → pulled from prod and cached locally.
- Guarded so the production server never mirrors to itself.

---

## Security model

**Honest disclosure — read before deploying:**

- The `apiKey` is embedded in the **client JavaScript bundle**. Anyone who opens DevTools can read it. This is acceptable for **private team review** (you control who has the URL and the password) but not for public feedback widgets.
- Login passwords are compared in plain text client-side. Good enough for team-of-5 review; not good enough for user accounts.
- Rate-limiting on failed login attempts is stored in `localStorage` (easy to bypass by clearing it). Server-side rate-limiting is left to the host app — add `express-rate-limit` if abuse is plausible.
- `safeFilename` sanitizes screenshot IDs to block path traversal. UUIDs are generated with `crypto.randomUUID()`.

For anything beyond internal review, fork and replace the auth layer.

---

## API reference

### `<ReviewProvider>` props

| Prop | Default | Notes |
|---|---|---|
| `users` | required | Array of `{ id, name, password, color, role }`. Password is erased before hitting state. |
| `apiKey` | required | Sent as `X-API-Key` on mutations. Must match the server. |
| `apiBase` | `"/api"` | Base URL of the API. |
| `captureScreenshots` | `true` | Set to `false` to disable the screenshot flow entirely. |
| `pollIntervalMs` | `10000` | How often to re-fetch comments from the server. |
| `screenshotTimeoutMs` | `8000` | Abort the screenshot capture after this many ms. |
| `storageKeyPrefix` | `"wak"` | Prefix for all `localStorage` keys. |
| `sessionCookieName` | `"wak_session"` | Cookie name for the 30-day session. |

### `<ReviewOverlay>` props

All optional. Accepts `currentPath`, `dashboardPath`, `hidePinsOn`, `LinkComponent`, `accentColor`.

### `<ReviewDashboard>` props

Accepts `LinkComponent`, `homePath`, `accentColor`, `title`.

### `createReviewRouter(options)`

`storage`, `apiKey`, `screenshotsDir`, `express` (the imported module), optional `jsonLimit`, optional `mirror`, optional `onInsert` hook.

---

## Run the demo

```bash
git clone <this-repo>
cd web-annotate-kit/example
npm install
npm run dev
# open http://localhost:5180
# log in as: alice / alice  (or: bob / bob)
```

You'll get two sample pages, a dashboard, and a SQLite file at `example/data/reviews.db`.

---

## License

MIT © Mario Hernández
