/**
 * HAI.ai persona loader: reads the catalogs from the database and resolves the
 * persona of one user (see persona.ts for the rules).
 *
 * The catalogs of the user come from the retrieval access (derived from the
 * session user and the database, see retrievalAccess.ts), the role from the
 * audience of that access, never from the client. The occupation chosen in the
 * app limits the persona to that one occupation (the other occupations of the
 * user are then "unselected own", see persona.ts). Fail closed: without an
 * access, without a matching catalog or on a database error the persona is
 * neutral (no knowledge, only a refusal).
 *
 * @module lib/hai/personaAccess
 */

import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import type { HaiTrainingScope } from './trainingScope';
import type { RetrievalAccess } from './retrievalAccess';
import {
  NEUTRAL_PERSONA,
  resolveHaiPersona,
  type CatalogPersonaSource,
  type HaiPersona,
} from './persona';

/**
 * Persona for the user of an access. `trainingScope` (built on the server from
 * the profile) gives the training phase of a trainee.
 */
export async function loadHaiPersona(
  access: RetrievalAccess | null,
  trainingScope?: Pick<HaiTrainingScope, 'currentPhase'>,
  preferredCatalogCode?: string | null
): Promise<HaiPersona> {
  if (!access || access.catalogIds.length === 0) return NEUTRAL_PERSONA;

  try {
    const rows = (await withDbRetry(() =>
      db
        .select({
          id: trainingCatalogs.id,
          code: trainingCatalogs.code,
          title: trainingCatalogs.title,
          settings: trainingCatalogs.settings,
        })
        .from(trainingCatalogs)
    )) as CatalogPersonaSource[];

    const byId = new Map(rows.map(row => [String(row.id), row]));
    const toRows = (ids: string[]) =>
      ids
        .map(id => byId.get(id))
        .filter((row): row is CatalogPersonaSource => !!row);
    // All occupations of the user: the access holds them all, or (with a choice
    // that narrowed the access) the full list next to the narrowed one
    const allOwn = toRows(access.allowedCatalogIds ?? access.catalogIds);
    let own = toRows(access.catalogIds);
    // The occupation the user has chosen in the app (header x-catalog) limits
    // the HAI to that one occupation, like the rest of the platform. A code
    // outside the occupations of the user is ignored (no right is gained,
    // nothing is lost). Without a code the persona speaks about all of them.
    const chosen = (preferredCatalogCode ?? '').trim().toLowerCase();
    if (chosen) {
      const match = allOwn.find(row => row.code.toLowerCase() === chosen);
      if (match) own = [match];
    }
    if (own.length === 0) return NEUTRAL_PERSONA;
    const ownIds = new Set(own.map(row => String(row.id)));
    const unselected =
      own.length < allOwn.length
        ? allOwn.filter(row => !ownIds.has(String(row.id)))
        : [];
    const allOwnIds = new Set(allOwn.map(row => String(row.id)));

    return resolveHaiPersona({
      catalogs: own,
      unselectedCatalogs: unselected,
      otherCatalogs: rows.filter(row => !allOwnIds.has(String(row.id))),
      role: access.audience === 'trainer' ? 'TRAINER' : 'TRAINEE',
      phase: access.audience === 'trainee' ? trainingScope?.currentPhase : null,
    });
  } catch (error) {
    console.error('HAI.ai: persona lookup failed (fail closed):', error);
    return NEUTRAL_PERSONA;
  }
}
