import {
  requireTrainer,
  requireCurriculumEditor,
  isErrorResponse,
} from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { getUserOrgId } from '@/lib/auth-helpers';
import { requireContentScope } from '@/lib/catalog/scope';
import {
  removeSubmissionFiles,
  submissionFileTargetsOfUseCases,
} from '@/lib/submission-file/on-delete';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ useCaseId: string }> }
) {
  try {
    const session = await requireTrainer(_req);
    if (isErrorResponse(session)) return session;

    const { useCases } = await import('@/db/migrations/schemas/schema');
    const { useCaseId } = await params;
    const catalogScope = await requireContentScope(session, _req, 'useCase', useCaseId);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const [row] = await db
      .select()
      .from(useCases)
      .where(eq(useCases.id, useCaseId as any));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ useCase: row });
  } catch (e) {
    console.error('Get use-case error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ useCaseId: string }> }
) {
  try {
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;

    const { useCases, courseMembers, notifications } =
      await import('@/db/migrations/schemas/schema');
    const { useCaseId } = await params;
    const catalogScope = await requireContentScope(session, req, 'useCase', useCaseId);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const { searchParams } = new URL(req.url);
    const trainerId = session.id;


    const [row0] = await db
      .select()
      .from(useCases)
      .where(eq(useCases.id, useCaseId as any));
    if (!row0) {
      return NextResponse.json(
        { error: 'Use case not found' },
        { status: 404 }
      );
    }

    // Curriculum writes are limited to the platform wide admin

    const body = await req.json();
    const updates: any = {};
    for (const key of [
      'title',
      'orderIndex',
      'durationValue',
      'durationUnit',
      'descriptionText',
      'isActive',
      'year',
      'trainingStage',
      'lernfelder',
    ]) {
      if (typeof body?.[key] !== 'undefined') updates[key] = body[key];
    }

    if (
      typeof body?.isActive === 'boolean' &&
      body.isActive &&
      !row0.isActive &&
      !row0.activatedAt
    ) {
      updates.activatedAt = new Date();
    }

    const [row] = await db
      .update(useCases)
      .set(updates)
      .where(eq(useCases.id, useCaseId as any))
      .returning();

    // Notify trainees when activated
    try {
      if (updates.activatedAt) {
        const traineeMemberRows = await db
          .select({ userId: courseMembers.userId })
          .from(courseMembers)
          .where(
            and(
              eq(courseMembers.courseId, row0.courseId as any),
              eq(courseMembers.role, 'TRAINEE' as any)
            )
          );
        if (traineeMemberRows.length) {
          const organizationId = await getUserOrgId(trainerId);
          const values = traineeMemberRows.map(m => ({
            userId: String(m.userId),
            actorId: trainerId,
            type: 'USE_CASE_ACTIVATED',
            title: 'Neuer Use Case aktiviert',
            message: `Ein Use Case wurde aktiviert: ${row0.title}`,
            linkUrl: '/trainee/modules',
            context: { useCaseId, courseId: row0.courseId },
            organizationId,
          }));
          await db.insert(notifications).values(values);
        }
      }
    } catch (notifyErr) {
      console.warn(
        'Failed to notify trainees for use-case activation',
        notifyErr
      );
    }

    return NextResponse.json({ useCase: row });
  } catch (e) {
    console.error('Update use-case error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ useCaseId: string }> }
) {
  try {
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;

    const { useCases } = await import('@/db/migrations/schemas/schema');
    const { useCaseId } = await params;
    const catalogScope = await requireContentScope(session, req, 'useCase', useCaseId);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const { searchParams } = new URL(req.url);
    const trainerId = session.id;


    const [row0] = await db
      .select()
      .from(useCases)
      .where(eq(useCases.id, useCaseId as any));
    if (!row0) {
      return NextResponse.json(
        { error: 'Use case not found' },
        { status: 404 }
      );
    }

    // Curriculum writes are limited to the platform wide admin

    // the submissions go with the use case (cascade), their files in the bucket do not
    const fileTargets = await submissionFileTargetsOfUseCases([useCaseId]);
    await db.delete(useCases).where(eq(useCases.id, useCaseId as any));
    await removeSubmissionFiles(fileTargets);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete use-case error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
