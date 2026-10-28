import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { FIAE_CATALOG_ID, isUuid, readJsonObject } from '@/lib/catalog/admin';
import {
  isConfirmedCode,
  isReleaseMode,
  loadReleaseOverview,
  runContentRelease,
} from '@/lib/catalog/content-release';
import { apiCache } from '@/lib/api-cache';
import db from '@/db';
import { NextRequest, NextResponse } from 'next/server';

const notFound = () =>
  NextResponse.json(
    { error: 'Training catalog not found', code: 'CATALOG_NOT_FOUND' },
    { status: 404 }
  );

/**
 * Release or lock the content of one training catalog in one step (courses,
 * enablers, use cases, quizzes), see src/lib/catalog/content-release.ts.
 *
 * Body: { mode: 'release' | 'lock', execute?: boolean, confirmCode?: string }.
 * Without execute: true it is a trial run that only counts. A real run needs
 * confirmCode, the code of the catalog typed as it is (400 otherwise, nothing
 * is written). The default occupation (FIAE) is live and its content is
 * switched by the trainers one by one, so a real run on it is refused (409,
 * the trial run still works). Never automatic, an import never calls this. Platform admin
 * only, the change is written to the protocol (activity_log) and the caches of
 * the trainee lists are cleared.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ catalogId: string }> }
) {
  try {
    const { catalogId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;
    if (!isUuid(catalogId)) return notFound();

    const body = await readJsonObject(req);
    if (!body || !isReleaseMode(body.mode)) {
      return NextResponse.json(
        { error: "mode must be 'release' or 'lock'", code: 'INVALID_MODE' },
        { status: 400 }
      );
    }
    const execute = body.execute === true;

    if (execute && catalogId === FIAE_CATALOG_ID) {
      return NextResponse.json(
        {
          error:
            'The default training catalog is switched by the trainers, not in one step',
          code: 'DEFAULT_CATALOG_PROTECTED',
        },
        { status: 409 }
      );
    }

    if (execute) {
      const overview = await loadReleaseOverview(db, catalogId);
      if (!overview) return notFound();
      if (!isConfirmedCode(body.confirmCode, overview.code)) {
        return NextResponse.json(
          {
            error: 'Type the code of the training catalog to confirm',
            code: 'CONFIRMATION_MISMATCH',
          },
          { status: 400 }
        );
      }
    }

    const result = await runContentRelease({
      catalogId,
      mode: body.mode,
      execute,
      actor: { id: session.id, organizationId: session.organizationId },
    });
    if (!result) return notFound();

    if (execute) {
      for (const tag of [
        'trainee_courses',
        'trainee_quizzes',
        'trainee_dashboard',
        'trainee_lernfelder',
      ]) {
        apiCache.invalidate(tag);
      }
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error('Admin content release error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
