import type { ReviewRecord, UserRecord } from './storage/types.js';

/**
 * Role-aware permission helper. Single source of truth for "who can do what".
 * Used both in the server router and (mirrored) in the client UI for affordance.
 */

export type ReviewAction =
  | 'edit'        // change text
  | 'delete'      // remove the comment
  | 'accept'      // mark as accepted (escalate to director)
  | 'resolve'     // close the comment
  | 'add-note'    // append a note (anyone authenticated)
  | 'reopen';     // revert accepted/resolved → open

export function canActOnComment(
  user: Pick<UserRecord, 'id' | 'name' | 'role' | 'departmentId'>,
  action: ReviewAction,
  comment: Pick<ReviewRecord, 'authorId' | 'author' | 'department' | 'status'>,
): boolean {
  if (!user) return false;

  // Identity is keyed to the immutable user id. For legacy rows without an authorId
  // (imported from < v0.3), fall back to the display name — those rows lose strong
  // authorship identity but at least preserve "looks like mine" for the original creator.
  const isMine = comment.authorId
    ? comment.authorId === user.id
    : comment.author === user.name;

  const isLeadOfThisDept =
    user.role === 'lead' && (comment.department === user.departmentId || comment.department === 'general');

  switch (action) {
    case 'add-note':
      return true; // any authenticated user can append a note
    case 'edit':
      // only the author can edit their own text. Director/admin can also edit.
      return isMine || user.role === 'director' || user.role === 'admin';
    case 'delete':
      // own comment → yes; otherwise only director/admin (leads cannot delete others')
      return isMine || user.role === 'director' || user.role === 'admin';
    case 'accept':
      // only the lead of the matching department (or 'general') can accept.
      // Director/admin can also accept directly.
      if (comment.status !== 'open') return false;
      return isLeadOfThisDept || user.role === 'director' || user.role === 'admin';
    case 'resolve':
      // strict gate: only accepted comments can be resolved (director/admin escalation flow).
      if (comment.status !== 'accepted') return false;
      return user.role === 'director' || user.role === 'admin';
    case 'reopen':
      // resolved → open. Director/admin only.
      if (comment.status !== 'resolved') return false;
      return user.role === 'director' || user.role === 'admin';
  }
}

export function canManageOrg(user: Pick<UserRecord, 'role'>): boolean {
  return user.role === 'admin';
}
