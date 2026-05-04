import express from 'express';
import { createReviewRouter, seedIfEmpty, sqliteStorage } from 'web-annotate-kit/server';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
mkdirSync(DATA_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3007;

const storage = await sqliteStorage({ path: join(DATA_DIR, 'reviews.db') });

// Seed an org on first boot. Idempotent — skipped automatically once data exists.
const { seededUsers, seededDepartments } = await seedIfEmpty(storage, {
  departments: [
    { id: 'design',      name: 'Design',      color: '#A855F7' },
    { id: 'linguistics', name: 'Linguistics', color: '#10B981' },
    { id: 'content',     name: 'Content',     color: '#F59E0B' },
  ],
  users: [
    { id: 'alice',  name: 'Alice',  password: 'alice-pw-2026',  color: '#3B82F6', role: 'admin' },
    { id: 'diana',  name: 'Diana',  password: 'diana-pw-2026',  color: '#EF4444', role: 'director' },
    { id: 'leo',    name: 'Leo',    password: 'leo-pw-2026',    color: '#A855F7', role: 'lead', departmentId: 'design' },
    { id: 'lena',   name: 'Lena',   password: 'lena-pw-2026',   color: '#10B981', role: 'lead', departmentId: 'linguistics' },
    { id: 'rita',   name: 'Rita',   password: 'rita-pw-2026',   color: '#F59E0B', role: 'reviewer' },
    { id: 'rob',    name: 'Rob',    password: 'rob-pw-2026',    color: '#06B6D4', role: 'reviewer' },
  ],
});
if (seededUsers || seededDepartments) {
  console.log(`[example] Seeded ${seededUsers} users and ${seededDepartments} departments.`);
}

app.use(
  '/api',
  createReviewRouter({
    storage,
    apiKey: 'demo-key-2026',
    sessionSecret: 'dev-session-secret-change-me-please-32+chars',
    routerMountPath: '/api',
    screenshotsDir: join(DATA_DIR, 'screenshots'),
    express,
  }),
);

// NOTE: there is no public static mount for screenshots anymore. Reads go
// through GET /api/screenshots/:file which requires a valid session.

app.listen(PORT, () => {
  console.log(`[example] API ready on http://localhost:${PORT}`);
  console.log(`[example] Database: ${join(DATA_DIR, 'reviews.db')}`);
});
