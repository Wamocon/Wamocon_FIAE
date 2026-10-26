/**
 * HAI.ai retrieval access: what the index search and the PageIndex may read
 * for one user.
 *
 * Everything is derived from the user id and the database, never from client
 * input (the role in the pipeline context is not used for access decisions):
 *  - catalogs: the catalog scope of the user (getCatalogScopeForUserId):
 *    trainees see their enrollment, trainer level the catalogs of the
 *    organization, super admins all catalogs
 *  - audience: 'trainer' for TRAINER, TEMP_ADMIN, ADMIN, SUPER_ADMIN,
 *    otherwise 'trainee' (an unknown role is treated as a trainee)
 *  - organization: profiles.organization_id
 *
 * Fail closed: if the profile or the scope cannot be determined the function
 * returns null and the caller must use no index content at all.
 *
 * @module lib/hai/retrievalAccess
 */

import { eq } from 'drizzle-orm';
import db from '@/db';
import { profiles } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import { isTrainerLevelRole } from '@/lib/auth/roles';
import { getCatalogScopeForUserId, readCatalogIds } from '@/lib/catalog/scope';
import type { SearchScope } from './vectorSearch';

/** Access of one user to the index; always has at least one catalog. */
export interface RetrievalAccess extends SearchScope {
  organizationId: string | null;
  userId: string;
}

/**
 * Resolve the retrieval access of a user, or null if it cannot be determined
 * (unknown user, no catalog scope, database error).
 */
export async function resolveRetrievalAccess(
  userId: string
): Promise<RetrievalAccess | null> {
  if (!userId) return null;

  try {
    const [profile] = await withDbRetry(() =>
      db
        .select({
          role: profiles.role,
          organizationId: profiles.organizationId,
        })
        .from(profiles)
        .where(eq(profiles.id, userId as any))
        .limit(1)
    );
    if (!profile) return null;

    const scope = await getCatalogScopeForUserId(userId);
    if (!scope) return null;

    const catalogIds = readCatalogIds(scope);
    if (catalogIds.length === 0) return null;

    return {
      catalogIds,
      audience: isTrainerLevelRole(profile.role) ? 'trainer' : 'trainee',
      organizationId: profile.organizationId
        ? String(profile.organizationId)
        : null,
      userId,
    };
  } catch (error) {
    console.error(
      'HAI.ai: retrieval access lookup failed (fail closed):',
      error
    );
    return null;
  }
}
