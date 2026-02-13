import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { verifyTrainer } from '@/lib/auth-helpers';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ useCaseId: string }> }
) {
  try {
    const { useCases } = await import('@/db/migrations/schemas/schema');
    const { useCaseId } = await params;
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
    const { useCases, courseMembers, notifications } =
      await import('@/db/migrations/schemas/schema');
    const { useCaseId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

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

    // Shared curriculum: any valid trainer can edit use cases
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

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
          const values = traineeMemberRows.map(m => ({
            userId: String(m.userId),
            actorId: trainerId,
            type: 'USE_CASE_ACTIVATED',
            title: 'Neuer Use Case aktiviert',
            message: `Ein Use Case wurde aktiviert: ${row0.title}`,
            linkUrl: '/trainee/modules',
            context: { useCaseId, courseId: row0.courseId },
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
    const { useCases } = await import('@/db/migrations/schemas/schema');
    const { useCaseId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

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

    // Shared curriculum: any valid trainer can delete use cases
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    await db.delete(useCases).where(eq(useCases.id, useCaseId as any));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete use-case error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
