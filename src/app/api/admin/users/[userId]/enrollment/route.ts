import {
  requireAdmin,
  requireSuperAdmin,
  isErrorResponse,
  scopeOrg,
  isInOrgScope,
} from '@/lib/auth/session';
import { normalizeRole, ROLE } from '@/lib/auth/roles';
import {
  addTraineeEnrollment,
  getTraineeEnrollment,
  isUuid,
  readJsonObject,
  removeTraineeEnrollment,
  ruleFailureBody,
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
 * The occupations of a trainee: every enrollment (the first one is the default
 * occupation), or FIAE when there is no row. The platform admin reads every
 * trainee, ADMIN and TEMP_ADMIN only the trainees of their own organization
 * (others are 404).
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
 * Data that depends on the enrollments of a trainee and is cached: the trainee
 * pages (the keys carry the catalog, but the rows behind them just changed).
 */
function invalidateEnrollmentCaches() {
  invalidateTraineeListCaches();
}

/**
 * Add an enrollment: the trainee is enrolled in one more training, the others
 * stay. Platform admin only. The trainee must have the role TRAINEE, the
 * catalog must be active and enabled for the organization of the trainee.
 * Optional `startDate` (yyyy-mm-dd or null) and `durationYears` (2 or 3) are the
 * terms of this training, without them the profile values are copied. Adding
 * the catalog the trainee is in already changes nothing.
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

    const result = await addTraineeEnrollment(userId, body.catalogId, {
      ...('startDate' in body
        ? { startDate: body.startDate as string | null }
        : {}),
      ...('durationYears' in body
        ? { durationYears: body.durationYears as number }
        : {}),
    });
    if (!result.ok) {
      return NextResponse.json(ruleFailureBody(result), {
        status: result.status,
      });
    }

    // A new enrollment gives the trainee the courses and global quizzes of
    // the phase plan of this catalog (only where the courses are linked to
    // components, FIAE courses are not). A failure is logged and does not undo
    // the enrollment, the platform admin can run the tool for the catalog
    // later.
    let contentSync: {
      courseMembersAdded: number;
      quizAssignmentsAdded: number;
    } | null = null;
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
      // The lists of the trainee are cached for minutes. The scope of the
      // trainee changed with the enrollment, so they are cleared whatever
      // became of the sync.
      invalidateEnrollmentCaches();
    }

    const view = await getTraineeEnrollment(userId);
    return NextResponse.json({
      ...view,
      changed: result.value.changed,
      enrollmentCount: result.value.enrollmentCount,
      ...(contentSync ? { contentSync } : {}),
    });
  } catch (e) {
    console.error('Admin add enrollment error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * Remove an enrollment: only the enrollment of the given catalog, only with the
 * explicit confirmation `confirm: true` in the body, never the last one of the
 * trainee. Platform admin only. Course memberships, quiz assignments and
 * submissions of the trainee are not touched, the chosen elective components of
 * this enrollment lapse (cascade).
 */
export async function DELETE(
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

    const result = await removeTraineeEnrollment(userId, body.catalogId, {
      confirmed: body.confirm === true,
    });
    if (!result.ok) {
      return NextResponse.json(ruleFailureBody(result), {
        status: result.status,
      });
    }

    invalidateEnrollmentCaches();

    const view = await getTraineeEnrollment(userId);
    return NextResponse.json({
      ...view,
      removed: result.value.trainingCatalogId,
      remaining: result.value.remaining,
    });
  } catch (e) {
    console.error('Admin remove enrollment error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
