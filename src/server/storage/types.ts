/* ─── Reviews ────────────────────────────────────────────── */

export type ReviewStatus = 'open' | 'accepted' | 'resolved';

export interface ReviewNoteRecord {
  id: string;
  author: string;
  authorColor: string;
  text: string;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  author: string;
  authorColor: string | null;
  page: string;
  x: number;
  y: number;
  text: string;
  createdAt: string;
  updatedAt: string | null;
  status: ReviewStatus;
  resolved: boolean;            // derived: status === 'resolved'
  department: string;           // default 'general'
  notes: ReviewNoteRecord[];
  acceptedAt: string | null;
  acceptedBy: string | null;
  section: string | null;
  nearestText: string | null;
  selector: string | null;
  tagName: string | null;
  screenshotUrl: string | null;
}

export interface ReviewStorage {
  list(): Promise<ReviewRecord[]>;
  insert(record: ReviewRecord): Promise<void>;
  updateText(id: string, text: string, updatedAt: string): Promise<void>;
  updateScreenshot(id: string, screenshotUrl: string): Promise<void>;
  setStatus(id: string, status: ReviewStatus, opts?: { acceptedBy?: string; acceptedAt?: string }): Promise<void>;
  /** Legacy: kept for back-compat. Toggles between open and resolved. */
  toggleResolved(id: string): Promise<void>;
  addNote(id: string, note: ReviewNoteRecord): Promise<void>;
  delete(id: string): Promise<string | null>;
}

/* ─── Users ──────────────────────────────────────────────── */

export type UserRole = 'reviewer' | 'lead' | 'director' | 'admin';

export interface UserRecord {
  id: string;
  name: string;
  passwordHash: string;
  color: string;
  role: UserRole;
  departmentId: string | null;
  createdAt: string;
}

/** Public projection of UserRecord (no password hash). */
export interface PublicUser {
  id: string;
  name: string;
  color: string;
  role: UserRole;
  departmentId: string | null;
}

export interface UserStorage {
  list(): Promise<UserRecord[]>;
  findByPassword(password: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  insert(record: UserRecord): Promise<void>;
  update(id: string, patch: Partial<Omit<UserRecord, 'id' | 'createdAt'>>): Promise<void>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

/* ─── Departments ────────────────────────────────────────── */

export interface DepartmentRecord {
  id: string;
  name: string;
  color: string;
}

export interface DepartmentStorage {
  list(): Promise<DepartmentRecord[]>;
  upsert(record: DepartmentRecord): Promise<void>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}
