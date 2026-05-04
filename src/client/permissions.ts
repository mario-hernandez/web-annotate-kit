/**
 * Client-side mirror of `src/server/permissions.ts`.
 * Used purely for affordance — the server is the source of truth.
 */
import type { ReviewComment, ReviewUser } from './types';

export type ClientReviewAction = 'edit' | 'delete' | 'accept' | 'resolve' | 'add-note' | 'reopen';

export function canActOnComment(
  user: ReviewUser | null,
  action: ClientReviewAction,
  comment: Pick<ReviewComment, 'author' | 'department' | 'status'>,
): boolean {
  if (!user) return false;

  const isMine = comment.author === user.name;
  const isLeadOfThisDept =
    user.role === 'lead' && (comment.department === user.departmentId || comment.department === 'general');

  switch (action) {
    case 'add-note':
      return true;
    case 'edit':
      return isMine || user.role === 'director' || user.role === 'admin';
    case 'delete':
      return isMine || user.role === 'director' || user.role === 'admin';
    case 'accept':
      if (comment.status !== 'open') return false;
      return isLeadOfThisDept || user.role === 'director' || user.role === 'admin';
    case 'resolve':
    case 'reopen':
      return user.role === 'director' || user.role === 'admin';
  }
}
