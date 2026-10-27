import { NextRequest, NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { resolveCatalogBranding } from '@/lib/catalog/branding';
import { resolvePhaseMonthsByDuration } from '@/lib/catalog/phase-plan';
import { FIAE_CATALOG_ID, requireCatalogScope } from '@/lib/catalog/scope';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

// The occupations of the signed in user, as far as the catalog scope allows
// them (trainee: the enrolled occupation, trainer and admin: the enabled and
// active ones, super admin: all). `?catalog=CODE` (or the header x-catalog)
// checks one occupation: unknown and foreign codes (for everybody but the
// super admin also inactive ones) are refused with 403 by the scope. Only code, title and the validated branding leave the
// server (title, short name and accent for the presentation, see
// src/lib/catalog/branding.ts) and the phase months for both durations (for
// the phase labels, see src/lib/catalog/phase-plan.ts), no ids and no other
// settings.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;

  const scope = await requireCatalogScope(session, req);
  if (scope instanceof Response) return scope;

  try {
    const rows = (await db
      .select({
        id: trainingCatalogs.id,
        code: trainingCatalogs.code,
        title: trainingCatalogs.title,
        settings: trainingCatalogs.settings,
        isActive: trainingCatalogs.isActive,
      })
      .from(trainingCatalogs)
      .where(inArray(trainingCatalogs.id, scope.allowedCatalogIds))) as {
      id: string;
      code: string;
      title: string;
      settings: unknown;
      isActive: boolean | null;
    }[];

    const allowed = new Set(scope.allowedCatalogIds);
    const catalogs = rows
      .filter(row => allowed.has(String(row.id)))
      .sort((a, b) => {
        const rank = (id: string) => (String(id) === FIAE_CATALOG_ID ? 0 : 1);
        return rank(a.id) - rank(b.id) || a.code.localeCompare(b.code);
      });
    const active = catalogs.find(
      row => String(row.id) === scope.activeCatalogId
    );

    return NextResponse.json(
      {
        catalogs: catalogs.map(({ code, title, settings, isActive }) => ({
          code,
          title,
          // a super admin also gets inactive catalogs (a tab marked inactive)
          isActive: isActive !== false,
          branding: resolveCatalogBranding(
            (settings as { branding?: unknown } | null)?.branding
          ),
          phaseMonths: resolvePhaseMonthsByDuration(settings),
        })),
        activeCode: active?.code ?? null,
        selected: scope.selected,
      },
      { headers: PRIVATE }
    );
  } catch (error) {
    console.error('Error in me/catalogs API:', error);
    return NextResponse.json(
      { error: 'Catalogs unavailable' },
      { status: 503, headers: PRIVATE }
    );
  }
}
