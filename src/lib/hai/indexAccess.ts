/**
 * Who may manage the shared HAI knowledge base (reindex, delete, status).
 *
 * The index (hai_embeddings, the reindex jobs, the content tables behind them)
 * has no organization column. One reindex or one delete therefore touches the
 * content of every organization, and the trainee indexer writes personal data
 * of all organizations. That is a platform operation, not an organization one.
 *
 * Allowed:
 *  - the platform-wide administrator (SUPER_ADMIN, or an ADMIN of the
 *    platform-owner organization while the backfill is pending), and
 *  - trainer-level users of the platform-owner organization (Wamocon), who
 *    maintain the shared curriculum and use the HAI Admin button today.
 *
 * Trainers and admins of a customer organization are not allowed.
 *
 * Pure functions only, so the sidebar can use the same rule as the routes.
 */

import {
  isSuperAdmin,
  isTrainerLevel,
  type RoleSubject,
} from '@/lib/auth/roles';

export function canManageHaiIndex(
  subject: RoleSubject | null | undefined
): boolean {
  if (!subject) return false;
  if (isSuperAdmin(subject)) return true;
  return isTrainerLevel(subject) && subject.isPlatformOwner === true;
}
