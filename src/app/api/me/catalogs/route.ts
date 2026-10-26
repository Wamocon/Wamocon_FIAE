import { NextRequest, NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { resolveCatalogBranding } from '@/lib/catalog/branding';
import { FIAE_CATALOG_ID, requireCatalogScope } from '@/lib/catalog/scope';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

// The occupations of the signed in user, as far as the catalog scope allows
// them (trainee: the enrolled occupation, trainer and admin: the enabled and
// active ones, super admin: all). `?catalog=CODE` (or the header x-catalog)
// checks one occupation: unknown, inactive and foreign codes are refused with
// 403 by the scope. Only code, title and the validated branding leave the
// server (title, short name and accent for the presentation, see
// src/lib/catalog/branding.ts), no ids and no other settings.
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
      })
      .from(trainingCatalogs)
      .where(inArray(trainingCatalogs.id, scope.allowedCatalogIds))) as {
      id: string;
      code: string;
      title: string;
      settings: unknown;
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
        catalogs: catalogs.map(({ code, title, settings }) => ({
          code,
          title,
          branding: resolveCatalogBranding(
            (settings as { branding?: unknown } | null)?.branding
          ),
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
