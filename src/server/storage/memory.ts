import type { ReviewRecord, ReviewStorage } from './types.js';

/**
 * In-memory storage. Useful for tests and demos. Data is lost on process exit.
 */
export function memoryStorage(): ReviewStorage {
  const rows = new Map<string, ReviewRecord>();

  return {
    async list() {
      return [...rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async insert(r) {
      rows.set(r.id, { ...r });
    },
    async updateText(id, text, updatedAt) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, text, updatedAt });
    },
    async updateScreenshot(id, screenshotUrl) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, screenshotUrl });
    },
    async toggleResolved(id) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, resolved: !r.resolved });
    },
    async delete(id) {
      const r = rows.get(id);
      rows.delete(id);
      return r?.screenshotUrl ?? null;
    },
  };
}
