import { NextResponse } from 'next/server';
import db from '@/db';
import { lernfelderSchema, useCases } from '@/db/migrations/schemas/schema';
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
        // Run both queries in PARALLEL – they are independent
        const [list, allUseCases] = await Promise.all([
          db
            .select()
            .from(lernfelderSchema)
            .orderBy(lernfelderSchema.createdAt),
          db
            .select({
              id: useCases.id,
              lernfelder: useCases.lernfelder,
              isActive: useCases.isActive,
            })
            .from(useCases),
        ]);

        const result = list.map(l => {
          const relevant = allUseCases.filter(
            u =>
              u.isActive &&
              u.lernfelder &&
              Array.isArray(u.lernfelder) &&
              u.lernfelder.includes(l.label)
          );
          return { ...l, useCaseCount: relevant.length };
        });

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
