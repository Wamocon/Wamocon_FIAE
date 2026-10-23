import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { resolveCatalogSettings } from '@/lib/catalog/settings';

// Public list of the active training catalogs (occupations) for the selection
// page before the login. Only what a visitor needs to choose an occupation:
// no ids, no internal settings (shortening threshold, rules). The list is the
// same for everybody, so shared caches may keep it.
export async function GET() {
  try {
    const rows = await db
      .select({
        code: trainingCatalogs.code,
        title: trainingCatalogs.title,
        description: trainingCatalogs.description,
        durationYears: trainingCatalogs.durationYears,
        occupationCode: trainingCatalogs.occupationCode,
        regulationVersion: trainingCatalogs.regulationVersion,
        settings: trainingCatalogs.settings,
      })
      .from(trainingCatalogs)
      .where(eq(trainingCatalogs.isActive, true))
      .orderBy(asc(trainingCatalogs.code));

    const catalogs = rows.map(row => {
      const settings = resolveCatalogSettings(row.settings);
      return {
        code: row.code,
        title: row.title,
        description: row.description,
        durationYears: row.durationYears,
        occupationCode: row.occupationCode,
        regulationVersion: row.regulationVersion,
        phaseMonths: settings.phaseMonths,
        schoolOrganization: settings.schoolOrganization,
      };
    });

    return NextResponse.json(
      { catalogs },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=59',
        },
      }
    );
  } catch (error: any) {
    // The catalog table does not exist before the catalog rollout (Production
    // today): the landing page must keep working, it just has nothing to list.
    if (error?.cause?.code === '42P01') {
      return NextResponse.json(
        { catalogs: [] },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    console.error('Error in catalogs API:', error);
    return NextResponse.json(
      { error: 'Catalogs unavailable' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
