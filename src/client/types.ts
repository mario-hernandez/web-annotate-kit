export type ReviewRole = 'reviewer' | 'lead' | 'director' | 'admin';

/** Comment lifecycle:
 *  - open      → reviewer just dropped it
 *  - accepted  → a lead validated it (= escalated to director's inbox)
 *  - resolved  → director executed / closed it
 */
export type ReviewStatus = 'open' | 'accepted' | 'resolved';

export interface ReviewDepartment {
  id: string;
  name: string;
  color: string;
}

export interface ReviewUser {
  id: string;
  name: string;
  color: string;
  role: ReviewRole;
  /** For role='lead': the department they own. Null/undefined for everyone else. */
  departmentId?: string | null;
}

/** User definition accepted as seed (server bootstrap). `password` is erased before it hits React state. */
export interface ReviewUserDef extends ReviewUser {
  password: string;
}

export interface ReviewNote {
  id: string;
  authorId?: string | null;
  author: string;
  authorColor: string;
  text: string;
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  /** Stable id of the author user. Optional for legacy rows. */
  authorId?: string | null;
  author: string;
  authorColor: string;
  page: string;
  x: number;
  y: number;
  text: string;
  createdAt: string;
  updatedAt?: string | null;
  /** Lifecycle status. Replaces the legacy boolean `resolved`. */
  status: ReviewStatus;
  /** True iff status === 'resolved'. Kept derived for backwards compat with existing UI bits. */
  resolved?: boolean;
  /** Department that should review this comment. Default: 'general' (everyone). */
  department: string;
  /** Notes ("addenda") added by anyone on top of the original comment. */
  notes?: ReviewNote[];
  /** Timestamp when a lead accepted it (= moment of escalation to the director). */
  acceptedAt?: string | null;
  /** Display name of the lead that accepted it. */
  acceptedBy?: string | null;
  /** Stable id of the lead that accepted it. */
  acceptedById?: string | null;
  section?: string | null;
  nearestText?: string | null;
  selector?: string | null;
  tagName?: string | null;
  screenshotUrl?: string | null;
}
