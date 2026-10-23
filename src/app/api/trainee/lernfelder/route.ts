import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  trainingCatalogLearningFields as learningFields,
  useCases,
} from '@/db/migrations/schemas/schema';
import { and, arrayContains, count, eq } from 'drizzle-orm';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';
import { catalogCacheKey, catalogCondition } from '@/lib/catalog/scope';
import { requireOptionalSessionScope } from '@/lib/catalog/public';
import { legacyLearningFieldSelect } from '@/lib/catalog/learning-fields';

/**
 * GET /api/trainee/lernfelder
 * Read-only list of the Lernfelder of the caller's catalog. With a session the
 * catalog scope of the user applies, anonymous callers get the active public
 * catalog (?catalog=CODE, default FIAE).
 */
export async function GET(req: NextRequest) {
  try {
    const scope = await requireOptionalSessionScope(req);
    if (scope instanceof Response) return scope;

    const cached = await apiCache.getOrFetch(
      `trainee_lernfelder_${catalogCacheKey(scope)}`,
      async () => {
        const list = await db
          .select(legacyLearningFieldSelect)
          .from(learningFields)
          .where(catalogCondition(learningFields.trainingCatalogId, scope))
          .orderBy(learningFields.createdAt);

        // Batch: get active use case counts per lernfeld label using SQL
        const countResults = await Promise.all(
          list.map(l =>
            db
              .select({ c: count() })
              .from(useCases)
              .where(
                and(
                  eq(useCases.isActive, true),
                  arrayContains(useCases.lernfelder, [l.label]),
                  eq(useCases.trainingCatalogId, l.trainingCatalogId)
                )
              )
              .then(rows => ({
                key: `${l.trainingCatalogId}:${l.label}`,
                count: Number(rows[0]?.c ?? 0),
              }))
          )
        );
        const countMap = new Map(countResults.map(r => [r.key, r.count]));

        const result = list.map(l => ({
          ...l,
          useCaseCount: countMap.get(`${l.trainingCatalogId}:${l.label}`) || 0,
        }));

        return { lernfelder: result };
      },
      ApiCache.TTL.LONG // 15 min, lernfelder data rarely changes
    );

    // The answer depends on the caller's catalog, so shared caches must not
    // store it (private, no-cache)
    return NextResponse.json(cached, { headers: cacheHeaders.medium });
  } catch (e) {
    console.error('Trainee list lernfelder error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
