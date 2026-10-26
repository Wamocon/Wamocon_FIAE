import {
  requireTrainer,
  requireCurriculumEditor,
  isErrorResponse,
} from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, max } from 'drizzle-orm';
import {
  enablers,
  courses,
  courseMembers,
  notifications,
} from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import { requireContentScope } from '@/lib/catalog/scope';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const session = await requireTrainer(_req);
    if (isErrorResponse(session)) return session;

    const { courseId } = await params;
    const catalogScope = await requireContentScope(session, _req, 'course', courseId);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const list = await db
      .select({
        id: enablers.id,
        title: enablers.title,
        orderIndex: enablers.orderIndex,
        isActive: enablers.isActive,
      })
      .from(enablers)
      .where(eq(enablers.courseId, courseId as any))
      .orderBy(enablers.orderIndex);
    return NextResponse.json({ enablers: list });
  } catch (e) {
    console.error('List enablers error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;

    const { courseId } = await params;
    const catalogScope = await requireContentScope(session, req, 'course', courseId);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const { searchParams } = new URL(req.url);
    const trainerId = session.id;


    // Verify course exists
    const [courseRow] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, courseId as any));
    if (!courseRow) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Curriculum writes are limited to the platform wide admin

    const organizationId = await getUserOrgId(trainerId);

    const body = await req.json();
    const title: string | undefined = body?.title;
    if (!title) {
      return NextResponse.json({ error: 'Missing title' }, { status: 400 });
    }

    const orderIndex: number | undefined = body?.orderIndex
      ? Number(body.orderIndex)
      : undefined;
    const durationValue: number | undefined = body?.durationValue
      ? Number(body.durationValue)
      : undefined;
    const durationUnitVal: 'DAYS' | 'WEEKS' | undefined =
      body?.durationUnit ||
      (typeof durationValue === 'number' ? 'DAYS' : undefined);
    const pptUrl: string | undefined = body?.pptUrl;
    const videoUrl: string | undefined = body?.videoUrl;
    const descriptionText: string | undefined = body?.descriptionText;
    const scenarioPdfUrl: string | undefined = body?.scenarioPdfUrl;
    const isActive: boolean | undefined =
      typeof body?.isActive === 'boolean' ? body.isActive : undefined;

    // Determine next order index if not provided
    let finalOrderIndex = orderIndex;
    if (
      typeof finalOrderIndex === 'undefined' ||
      Number.isNaN(finalOrderIndex)
    ) {
      const [m] = await db
        .select({ m: max(enablers.orderIndex) })
        .from(enablers)
        .where(eq(enablers.courseId, courseId as any));
      finalOrderIndex = (Number(m?.m ?? 0) || 0) + 1;
    }

    const activatedAt = isActive ? new Date() : null;
    const [inserted] = await db
      .insert(enablers)
      .values({
        courseId: courseId as any,
        title,
        orderIndex: finalOrderIndex as any,
        durationValue: durationValue as any,
        durationUnit: durationUnitVal as any,
        descriptionText: descriptionText as any,
        pptUrl: pptUrl as any,
        videoUrl: videoUrl as any,
        scenarioPdfUrl: scenarioPdfUrl as any,
        isActive: isActive as any,
        activatedAt: activatedAt as any,
      })
      .returning();

    // Notify course trainees if the enabler is created as active
    if (isActive) {
      try {
        const traineeMembers = await db
          .select({ userId: courseMembers.userId })
          .from(courseMembers)
          .where(
            and(
              eq(courseMembers.courseId, courseId as any),
              eq(courseMembers.role, 'TRAINEE')
            )
          );
        if (traineeMembers.length > 0) {
          const notifValues = traineeMembers.map(m => ({
            userId: String(m.userId),
            actorId: trainerId,
            type: 'ENABLER_CREATED',
            title: 'Neue Lesson verfügbar',
            message: `Eine neue Lesson "${title}" wurde aktiviert.`,
            linkUrl: '/trainee/modules',
            context: { enablerId: inserted.id, courseId },
            organizationId,
          }));
          await db.insert(notifications).values(notifValues);
        }
      } catch (notifyErr) {
        console.warn(
          'Failed to notify trainees for enabler creation',
          notifyErr
        );
      }
    }

    return NextResponse.json({ enabler: inserted });
  } catch (e) {
    console.error('Create enabler error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
