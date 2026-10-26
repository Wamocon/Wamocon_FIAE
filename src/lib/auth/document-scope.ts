/**
 * Who sees and who deletes the documents of enablers and use cases
 * (table content_documents).
 *
 * A document carries the organization of the person who uploaded it. The
 * shared curriculum has two forms: documents without an organization and
 * documents of the platform organization (organizations.is_platform_owner).
 * Rules, derived from the session only:
 *
 *  - SEE: the shared curriculum and the documents of the own organization
 *    (scopeOrg). The documents of another customer are never listed. The super
 *    admin sees every document.
 *  - DELETE: the super admin, and a person for a document of the own
 *    organization. The shared curriculum and the platform documents are deleted
 *    by the super admin only (the ADMIN of the platform organization is one,
 *    see isSuperAdmin in roles.ts). The platform flag of a person widens
 *    nothing: a trainer of the platform organization has no more rights here
 *    than any other trainer.
 */

import { eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import db from '@/db';
import { organizations } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import { isInOrgScope, scopeOrg, type SessionUser } from '@/lib/auth/session';

/**
 * Condition on the organization column of content_documents for a list.
 * undefined means no restriction (super admin).
 */
export function documentVisibilityCondition(
  column: PgColumn,
  session: SessionUser
): SQL | undefined {
  const scope = scopeOrg(session);
  if (scope.organizationId === null) return undefined;
  return sql`(${column} is null or ${column} = ${scope.organizationId} or ${column} in (select ${organizations.id} from ${organizations} where ${organizations.isPlatformOwner} = true))`;
}

/** Ids of the organizations that carry the platform flag. */
export async function loadPlatformOrgIds(): Promise<Set<string>> {
  const rows = await withDbRetry(() =>
    db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.isPlatformOwner, true))
  );
  return new Set(rows.map(row => String(row.id)));
}

/**
 * Whether the session may add a document that will carry `organizationId` (the
 * organization of the person). Documents of the platform organization are
 * curriculum: only the super admin adds them, like the rest of the curriculum
 * (requireCurriculumEditor). A person of a customer organization adds documents
 * of the own organization.
 */
export function canCreateDocument(
  session: SessionUser,
  organizationId: string,
  platformOrgIds: ReadonlySet<string>
): boolean {
  if (session.isSuperAdmin) return true;
  return !platformOrgIds.has(String(organizationId));
}

/**
 * Whether the session may delete the document. `platformOrgIds` comes from
 * loadPlatformOrgIds.
 */
export function canDeleteDocument(
  session: SessionUser,
  doc: { organizationId: string | null | undefined },
  platformOrgIds: ReadonlySet<string>
): boolean {
  if (session.isSuperAdmin) return true;
  // The shared curriculum
  if (doc.organizationId === null || doc.organizationId === undefined) {
    return false;
  }
  // Documents of the platform organization are shared curriculum too
  if (platformOrgIds.has(String(doc.organizationId))) return false;
  return isInOrgScope(scopeOrg(session), String(doc.organizationId));
}
