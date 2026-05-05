/**
 * Client-side mirror of `src/server/permissions.ts`.
 * Used purely for affordance — the server is the source of truth.
 */
import type { ReviewComment, ReviewUser } from './types';

export type ClientReviewAction = 'edit' | 'delete' | 'accept' | 'resolve' | 'add-note' | 'reopen';

export function canActOnComment(
  user: ReviewUser | null,
  action: ClientReviewAction,
  comment: Pick<ReviewComment, 'authorId' | 'author' | 'department' | 'status'>,
): boolean {
  if (!user) return false;

  // Mirrors the server: legacy rows without authorId have no provable owner.
  const isMine = !!comment.authorId && comment.authorId === user.id;
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
      if (comment.status !== 'accepted') return false;
      return user.role === 'director' || user.role === 'admin';
    case 'reopen':
      if (comment.status !== 'resolved') return false;
      return user.role === 'director' || user.role === 'admin';
  }
}
