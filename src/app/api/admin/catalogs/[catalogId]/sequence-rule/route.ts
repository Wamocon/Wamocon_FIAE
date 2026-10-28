import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { isUuid, readJsonObject } from '@/lib/catalog/admin';
import {
  getSequenceSince,
  saveSequenceSince,
  sequenceRuleBodySchema,
} from '@/lib/catalog/sequence-rule';
import { NextRequest, NextResponse } from 'next/server';
import { apiCache } from '@/lib/api-cache';

const notFound = () =>
  NextResponse.json(
    { error: 'Training catalog not found', code: 'CATALOG_NOT_FOUND' },
    { status: 404 }
  );

/**
 * Read the cut-off date of the order of work of a training catalog. Platform
 * admin only, like the change.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ catalogId: string }> }
) {
  try {
    const { catalogId } = await params;
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;
    if (!isUuid(catalogId)) return notFound();

    const since = await getSequenceSince(catalogId);
    if (since === undefined) return notFound();
    return NextResponse.json({ catalogId, since });
  } catch (e) {
    console.error('Admin read sequence rule error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * Set or remove the cut-off date of the order of work of a training catalog.
 * Body: { since: "2026-11-01" | an ISO timestamp | null }. From that moment a
 * trainee who joins the catalog works through the enablers one after the
 * other, trainees who joined earlier are not affected. null removes the date
 * (the order is not in force). The date is set by hand, never automatically.
 * Platform admin only (the same right as every other change of the
 * curriculum). The change is written to the activity log.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ catalogId: string }> }
) {
  try {
    const { catalogId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;
    if (!isUuid(catalogId)) return notFound();

    const parsed = sequenceRuleBodySchema.safeParse(await readJsonObject(req));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'since must be a date (YYYY-MM-DD), an ISO timestamp or null',
          code: 'INVALID_SINCE',
        },
        { status: 400 }
      );
    }

    const since = await saveSequenceSince(catalogId, parsed.data.since, {
      id: session.id,
      organizationId: session.organizationId,
    });
    if (since === undefined) return notFound();
    // The dashboard caches the next item, which depends on the order
    apiCache.invalidate('trainee_dashboard');
    return NextResponse.json({ catalogId, since });
  } catch (e) {
    console.error('Admin update sequence rule error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
