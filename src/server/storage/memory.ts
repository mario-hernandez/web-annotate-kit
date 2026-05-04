import type {
  DepartmentRecord, DepartmentStorage,
  ReviewNoteRecord, ReviewRecord, ReviewStatus, ReviewStorage,
  UserRecord, UserStorage,
} from './types.js';
import { verifyPassword } from '../auth.js';

/**
 * In-memory storage for reviews + users + departments. Useful for tests and
 * demos. Data is lost on process exit.
 */
export function memoryStorage(): {
  reviews: ReviewStorage;
  users: UserStorage;
  departments: DepartmentStorage;
} {
  const reviews = new Map<string, ReviewRecord>();
  const users = new Map<string, UserRecord>();
  const departments = new Map<string, DepartmentRecord>();

  const reviewsApi: ReviewStorage = {
    async list() {
      return [...reviews.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async insert(r) { reviews.set(r.id, { ...r }); },
    async updateText(id, text, updatedAt) {
      const r = reviews.get(id);
      if (r) reviews.set(id, { ...r, text, updatedAt });
    },
    async updateScreenshot(id, screenshotUrl) {
      const r = reviews.get(id);
      if (r) reviews.set(id, { ...r, screenshotUrl });
    },
    async setStatus(id, status: ReviewStatus, opts) {
      const r = reviews.get(id);
      if (!r) return;
      reviews.set(id, {
        ...r,
        status,
        resolved: status === 'resolved',
        acceptedAt: opts?.acceptedAt ?? r.acceptedAt,
        acceptedBy: opts?.acceptedBy ?? r.acceptedBy,
      });
    },
    async toggleResolved(id) {
      const r = reviews.get(id);
      if (!r) return;
      const next: ReviewStatus = r.status === 'resolved' ? 'open' : 'resolved';
      reviews.set(id, { ...r, status: next, resolved: next === 'resolved' });
    },
    async addNote(id, note: ReviewNoteRecord) {
      const r = reviews.get(id);
      if (!r) return;
      reviews.set(id, { ...r, notes: [...r.notes, note] });
    },
    async delete(id) {
      const r = reviews.get(id);
      reviews.delete(id);
      return r?.screenshotUrl ?? null;
    },
  };

  const usersApi: UserStorage = {
    async list() { return [...users.values()].sort((a, b) => a.name.localeCompare(b.name)); },
    async findByPassword(password) {
      for (const u of users.values()) {
        if (verifyPassword(password, u.passwordHash)) return u;
      }
      return null;
    },
    async findById(id) { return users.get(id) ?? null; },
    async insert(record) { users.set(record.id, { ...record }); },
    async update(id, patch) {
      const u = users.get(id);
      if (!u) return;
      users.set(id, { ...u, ...patch });
    },
    async delete(id) { users.delete(id); },
    async count() { return users.size; },
  };

  const deptsApi: DepartmentStorage = {
    async list() { return [...departments.values()].sort((a, b) => a.name.localeCompare(b.name)); },
    async upsert(record) { departments.set(record.id, { ...record }); },
    async delete(id) { departments.delete(id); },
    async count() { return departments.size; },
  };

  return { reviews: reviewsApi, users: usersApi, departments: deptsApi };
}
