import { requireAdmin, isErrorResponse } from '@/lib/auth/session';
import {
  isUuid,
  listUsableCatalogIds,
  readJsonObject,
} from '@/lib/catalog/admin';
import { runCatalogContentSync } from '@/lib/catalog/trainee-content';
import { apiCache } from '@/lib/api-cache';
import { NextRequest, NextResponse } from 'next/server';

const notFound = () =>
  NextResponse.json(
    { error: 'Training catalog not found', code: 'CATALOG_NOT_FOUND' },
    { status: 404 }
  );

/**
 * Give the trainees of a training catalog the courses and global quizzes of
 * their phase plan (course_members, quiz_assignments), see
 * src/lib/catalog/trainee-content.ts. Insert only, never deletes, safe to run
 * twice.
 *
 * Body: { execute?: boolean, organizationId?: uuid }. Without execute: true it
 * is a trial run that only counts. The answer has the numbers, no trainee ids.
 *
 * Who: the platform admin for any organization (organizationId narrows it, no
 * organizationId means all), ADMIN and TEMP_ADMIN of an organization only for
 * the trainees of their OWN organization (a given organizationId is ignored)
 * and only for a catalog that is enabled and active for it. The organization
 * comes from the session. Trainees without an organization are never touched
 * by an organization admin and are only counted as skipped for the platform
 * admin. Trainers answer 403, anonymous 401.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ catalogId: string }> }
) {
  try {
    const { catalogId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireAdmin(req);
    if (isErrorResponse(session)) return session;
    if (!isUuid(catalogId)) return notFound();

    const body = (await readJsonObject(req)) ?? {};
    const execute = body.execute === true;

    let organizationId: string | undefined;
    if (session.isSuperAdmin) {
      if (body.organizationId !== undefined && body.organizationId !== null) {
        if (!isUuid(body.organizationId)) {
          return NextResponse.json(
            { error: 'organizationId must be a uuid' },
            { status: 400 }
          );
        }
        organizationId = body.organizationId;
      }
    } else {
      organizationId = session.organizationId;
      const usable = await listUsableCatalogIds(organizationId);
      if (!usable.includes(catalogId)) return notFound();
    }

    const result = await runCatalogContentSync({
      catalogId,
      actorId: session.id,
      execute,
      organizationId,
      // The explicit tool also assigns the active global quizzes that belong
      // to no component (FIAE), the automatic runs do not
      includeUnlinkedGlobalQuizzes: true,
    });
    if (!result) return notFound();

    if (execute) {
      apiCache.invalidate('trainee_courses');
      apiCache.invalidate('trainee_quizzes');
      apiCache.invalidate('trainee_dashboard');
    }

    const { details, ...summary } = result;
    void details;
    return NextResponse.json(summary);
  } catch (e) {
    console.error('Admin trainee content sync error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
