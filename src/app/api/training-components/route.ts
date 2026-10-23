import { NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { trainingComponents } from '@/db/migrations/schemas/schema';
import {
  publicCatalogHeaders,
  resolvePublicCatalog,
} from '@/lib/catalog/public';

// Public list of the training components of one active catalog
// (?catalog=CODE, default FIAE). The catalog is part of the URL, so shared
// caches keep the catalogs apart (see publicCatalogHeaders).
export async function GET(req: Request) {
  try {
    const catalog = await resolvePublicCatalog(req);
    if (!catalog) {
      return NextResponse.json(
        { error: 'Training catalog not found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const components = await db
      .select()
      .from(trainingComponents)
      .where(eq(trainingComponents.trainingCatalogId, catalog.id))
      .orderBy(trainingComponents.orderIndex);

    // Transform to camelCase for frontend
    const formattedComponents = components.map(c => ({
      id: c.id,
      code: c.code,
      title: c.title,
      description: c.description,
      totalWeeks: c.totalWeeks,
      totalHours: c.totalHours,
      trainingYear: c.trainingYear,
      orderIndex: c.orderIndex,
      createdAt: c.createdAt,
      // Phase 1 or 2, null = integrative or not filled (clients fall back to
      // orderIndex, see getComponentPhase in @/lib/ausbildung/duration)
      phase: c.phase ?? null,
      kind: c.kind ?? 'pflicht',
    }));

    return NextResponse.json(
      { components: formattedComponents },
      {
        headers: publicCatalogHeaders(
          catalog,
          'public, s-maxage=300, stale-while-revalidate=59'
        ),
      }
    );
  } catch (error: any) {
    // If table doesn't exist yet, return empty components
    if (error?.cause?.code === '42P01') {
      console.warn(
        'Table training_components does not exist yet - returning empty components'
      );
      return NextResponse.json({ components: [] });
    }
    console.error('Error in training-components API:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
