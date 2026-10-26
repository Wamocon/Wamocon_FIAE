/**
 * HAI.ai persona loader: reads the catalogs from the database and resolves the
 * persona of one user (see persona.ts for the rules).
 *
 * The catalogs of the user come from the retrieval access (derived from the
 * session user and the database, see retrievalAccess.ts), the role from the
 * audience of that access, never from the client. Fail closed: without an
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
  trainingScope?: Pick<HaiTrainingScope, 'currentPhase'>
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
    const own = access.catalogIds
      .map(id => byId.get(id))
      .filter((row): row is CatalogPersonaSource => !!row);
    if (own.length === 0) return NEUTRAL_PERSONA;
    const ownIds = new Set(own.map(row => String(row.id)));

    return resolveHaiPersona({
      catalogs: own,
      otherCatalogs: rows.filter(row => !ownIds.has(String(row.id))),
      role: access.audience === 'trainer' ? 'TRAINER' : 'TRAINEE',
      phase: access.audience === 'trainee' ? trainingScope?.currentPhase : null,
    });
  } catch (error) {
    console.error('HAI.ai: persona lookup failed (fail closed):', error);
    return NEUTRAL_PERSONA;
  }
}
