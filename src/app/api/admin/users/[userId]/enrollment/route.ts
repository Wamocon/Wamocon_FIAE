import {
  requireAdmin,
  requireSuperAdmin,
  isErrorResponse,
  scopeOrg,
  isInOrgScope,
} from '@/lib/auth/session';
import { normalizeRole, ROLE } from '@/lib/auth/roles';
import {
  getTraineeEnrollment,
  isUuid,
  readJsonObject,
  ruleFailureBody,
  setTraineeEnrollment,
} from '@/lib/catalog/admin';
import { syncTraineeContentAfterEnrollment } from '@/lib/catalog/trainee-content';
import { invalidateTraineeListCaches } from '@/lib/catalog/trainee-cache';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';

const userNotFound = () =>
  NextResponse.json({ error: 'User not found' }, { status: 404 });

const notATrainee = () =>
  NextResponse.json(
    ruleFailureBody({ ok: false, status: 400, code: 'NOT_A_TRAINEE' }),
    { status: 400 }
  );

async function findUser(userId: string) {
  const [user] = await db
    .select({
      id: profiles.id,
      role: profiles.role,
      organizationId: profiles.organizationId,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return user;
}

/**
 * The occupation of a trainee: the enrollment, or FIAE when there is no row.
 * The platform admin reads every trainee, ADMIN and TEMP_ADMIN only the
 * trainees of their own organization (others are 404).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireAdmin(req);
    if (isErrorResponse(session)) return session;

    if (!isUuid(userId)) return userNotFound();
    const user = await findUser(userId);
    // Users of other organizations are invisible to org admins
    if (!user || !isInOrgScope(scopeOrg(session), user.organizationId)) {
      return userNotFound();
    }
    if (normalizeRole(user.role) !== ROLE.TRAINEE) return notATrainee();

    return NextResponse.json(await getTraineeEnrollment(userId));
  } catch (e) {
    console.error('Admin get enrollment error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * Set the occupation of a trainee. Platform admin only. The trainee must have
 * the role TRAINEE, the catalog must be active and enabled for the
 * organization of the trainee. The other enrollments of the trainee are
 * removed in the same transaction, so a trainee always has exactly one
 * occupation. Chosen elective components of the old occupation lapse.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireSuperAdmin(req);
    if (isErrorResponse(session)) return session;

    if (!isUuid(userId)) return userNotFound();

    const body = await readJsonObject(req);
    if (!body || !isUuid(body.catalogId)) {
      return NextResponse.json(
        { error: 'catalogId (uuid) is required' },
        { status: 400 }
      );
    }

    const user = await findUser(userId);
    if (!user) return userNotFound();

    const result = await setTraineeEnrollment(userId, body.catalogId);
    if (!result.ok) {
      return NextResponse.json(ruleFailureBody(result), {
        status: result.status,
      });
    }

    // A new enrollment gives the trainee the courses and global quizzes of
    // the phase plan (only where the courses are linked to components, FIAE
    // courses are not). A failure is logged and does not undo the enrollment,
    // the platform admin can run the tool for the catalog later.
    let contentSync: { courseMembersAdded: number; quizAssignmentsAdded: number } | null =
      null;
    if (result.value.changed) {
      const sync = await syncTraineeContentAfterEnrollment({
        catalogId: body.catalogId,
        traineeId: userId,
        actorId: session.id,
      });
      if (sync) {
        contentSync = {
          courseMembersAdded: sync.courseMembersAdded,
          quizAssignmentsAdded: sync.quizAssignmentsAdded,
        };
      }
      // The lists of the trainee (Lernen, Quizze) are cached for minutes. The
      // scope of the trainee changed with the enrollment, so they are cleared
      // whatever became of the sync (a failed sync used to leave them as they
      // were).
      invalidateTraineeListCaches();
    }

    const view = await getTraineeEnrollment(userId);
    return NextResponse.json({
      ...view,
      changed: result.value.changed,
      replaced: result.value.replaced,
      ...(contentSync ? { contentSync } : {}),
    });
  } catch (e) {
    console.error('Admin set enrollment error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
