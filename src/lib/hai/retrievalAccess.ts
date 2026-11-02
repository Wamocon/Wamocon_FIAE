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
 *  - the chosen occupation: when the app sends one (header x-catalog) and it is
 *    one of the occupations of the user, the HAI works only in that one, like
 *    the rest of the platform (and like the quiz mode). A code outside the
 *    occupations of the user is ignored: no right is gained, nothing is lost,
 *    no 403. Without a code the user gets all occupations as before.
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
import {
  CATALOG_HEADER,
  getCatalogScopeForUserId,
  readCatalogIds,
} from '@/lib/catalog/scope';
import type { SearchScope } from './vectorSearch';

/** Access of one user to the index; always has at least one catalog. */
export interface RetrievalAccess extends SearchScope {
  organizationId: string | null;
  userId: string;
  /**
   * All occupations of the user, only set when a chosen occupation narrowed
   * `catalogIds` to one. The search never reads it (the persona needs it to
   * know the other own occupations for the answer "switch the tab").
   */
  allowedCatalogIds?: string[];
}

/** The occupations to read and, if a choice narrowed them, all of the user. */
export interface CatalogChoice {
  catalogIds: string[];
  allowedCatalogIds: string[];
  /** The code of the request named one of the occupations of the user. */
  chosen: boolean;
}

/**
 * The occupations the HAI reads for a user. With a code that belongs to the
 * user this is that one occupation (the same rule as the routes of the
 * platform and the quiz mode, getCatalogScopeForUserId with the header). A code
 * that does not belong to the user is ignored and the user gets everything as
 * without a code. Null if the scope cannot be determined (fail closed).
 */
export async function resolveCatalogChoice(
  userId: string,
  chosenCode?: string | null
): Promise<CatalogChoice | null> {
  const code = (chosenCode ?? '').trim();
  if (code) {
    const headers = new Headers({ [CATALOG_HEADER]: code });
    const chosen = await getCatalogScopeForUserId(userId, { headers });
    // null: a code outside the occupations of the user (403) or no scope
    if (chosen) {
      const catalogIds = readCatalogIds(chosen);
      if (chosen.selected && catalogIds.length === 1) {
        return {
          catalogIds,
          allowedCatalogIds: chosen.allowedCatalogIds,
          chosen: true,
        };
      }
    }
  }
  const scope = await getCatalogScopeForUserId(userId);
  if (!scope) return null;
  const catalogIds = readCatalogIds(scope);
  if (catalogIds.length === 0) return null;
  return { catalogIds, allowedCatalogIds: catalogIds, chosen: false };
}

/**
 * Resolve the retrieval access of a user, or null if it cannot be determined
 * (unknown user, no catalog scope, database error).
 */
export async function resolveRetrievalAccess(
  userId: string,
  chosenCode?: string | null
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

    const choice = await resolveCatalogChoice(userId, chosenCode);
    if (!choice) return null;
    const { catalogIds } = choice;

    return {
      catalogIds,
      ...(choice.chosen && choice.allowedCatalogIds.length > catalogIds.length
        ? { allowedCatalogIds: choice.allowedCatalogIds }
        : {}),
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
