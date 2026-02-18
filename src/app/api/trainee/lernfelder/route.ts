import { NextResponse } from 'next/server';
import db from '@/db';
import { lernfelderSchema, useCases } from '@/db/migrations/schemas/schema';
import { and, arrayContains, count, eq } from 'drizzle-orm';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';

/**
 * GET /api/trainee/lernfelder
 * Read-only list for trainees.
 */
export async function GET() {
  try {
    const cached = await apiCache.getOrFetch(
      'trainee_lernfelder',
      async () => {
        const list = await db
          .select()
          .from(lernfelderSchema)
          .orderBy(lernfelderSchema.createdAt);

        // Batch: get active use case counts per lernfeld label using SQL
        const countResults = await Promise.all(
          list.map(l =>
            db
              .select({ c: count() })
              .from(useCases)
              .where(
                and(
                  eq(useCases.isActive, true),
                  arrayContains(useCases.lernfelder, [l.label])
                )
              )
              .then(rows => ({
                label: l.label,
                count: Number(rows[0]?.c ?? 0),
              }))
          )
        );
        const countMap = new Map(countResults.map(r => [r.label, r.count]));

        const result = list.map(l => ({
          ...l,
          useCaseCount: countMap.get(l.label) || 0,
        }));

        return { lernfelder: result };
      },
      ApiCache.TTL.LONG // 15 min – lernfelder data rarely changes
    );

    return NextResponse.json(cached, { headers: cacheHeaders.long });
  } catch (e) {
    console.error('Trainee list lernfelder error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
