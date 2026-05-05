/* ─── Reviews ────────────────────────────────────────────── */

export type ReviewStatus = 'open' | 'accepted' | 'resolved';

export interface ReviewNoteRecord {
  id: string;
  authorId: string | null;
  author: string;
  authorColor: string;
  text: string;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  /** Stable id of the author user. Null for legacy rows imported from < v0.3. */
  authorId: string | null;
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
  acceptedById: string | null;
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
  updateScreenshot(id: string, screenshotUrl: string | null): Promise<void>;
  setStatus(id: string, status: ReviewStatus, opts?: { acceptedBy?: string; acceptedById?: string; acceptedAt?: string }): Promise<void>;
  /** Legacy: kept for back-compat. Toggles between open and resolved. */
  toggleResolved(id: string): Promise<void>;
  addNote(id: string, note: ReviewNoteRecord): Promise<void>;
  delete(id: string): Promise<string | null>;
  /** Backfill author_id on legacy rows. Optional: not all storages need to support it. */
  setAuthorId?(id: string, authorId: string): Promise<void>;
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
  /** Bumped on every password change. Embedded in session tokens; mismatched cookies are rejected. */
  sessionVersion: number;
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
  /**
   * Inserts only if no row with this id already exists. Atomic. Returns true
   * when a new row was written, false when one already existed. Safe to call
   * concurrently from multiple booting instances.
   */
  insertIfNotExists(record: UserRecord): Promise<boolean>;
  update(id: string, patch: Partial<Omit<UserRecord, 'id' | 'createdAt'>>): Promise<void>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
  /**
   * Atomic guarded patch. Applies the patch only if it would NOT leave the org
   * with zero admins. Returns true when the patch was applied, false when it
   * was rejected by the invariant. Implementations must enforce this in a
   * single transactional statement (no read-then-write race window).
   */
  updateUnlessLastAdmin(id: string, patch: Partial<Omit<UserRecord, 'id' | 'createdAt'>>): Promise<boolean>;
  /**
   * Atomic guarded delete. Same semantics as updateUnlessLastAdmin but for delete.
   */
  deleteUnlessLastAdmin(id: string): Promise<boolean>;
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
