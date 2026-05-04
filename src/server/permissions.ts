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
  comment: Pick<ReviewRecord, 'author' | 'department' | 'status'>,
): boolean {
  if (!user) return false;

  const isMine = comment.author === user.name;
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
      // only director/admin (after acceptance, but we don't strictly enforce sequencing).
      return user.role === 'director' || user.role === 'admin';
    case 'reopen':
      return user.role === 'director' || user.role === 'admin';
  }
}

export function canManageOrg(user: Pick<UserRecord, 'role'>): boolean {
  return user.role === 'admin';
}
