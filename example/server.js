import express from 'express';
import { createReviewRouter, sqliteStorage } from 'web-annotate-kit/server';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
mkdirSync(DATA_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3002;

const storage = await sqliteStorage({ path: join(DATA_DIR, 'reviews.db') });

app.use(
  '/api',
  createReviewRouter({
    storage,
    apiKey: 'demo-key-2026',
    screenshotsDir: join(DATA_DIR, 'screenshots'),
    express,
  }),
);

// Also serve the screenshots dir outside /api so <img src> works the same way.
app.use('/screenshots', express.static(join(DATA_DIR, 'screenshots')));

app.listen(PORT, () => {
  console.log(`[example] API ready on http://localhost:${PORT}`);
  console.log(`[example] Database: ${join(DATA_DIR, 'reviews.db')}`);
});
