import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { courses, courseMembers, useCases, useCaseSubmissions, notifications } from '@/db/migrations/schemas/schema';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const { submissionId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    const body = await req.json();
    const status: 'PENDING' | 'APPROVED' | 'REJECTED' | undefined = body?.status;
    const trainerFeedback: string | null | undefined = body?.trainerFeedback ?? undefined;
    if (!status) return NextResponse.json({ error: 'Missing status' }, { status: 400 });

    const [sub] = await db.select().from(useCaseSubmissions).where(eq(useCaseSubmissions.id, submissionId));
    if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [uc] = await db.select().from(useCases).where(eq(useCases.id, sub.useCaseId));
    if (!uc) return NextResponse.json({ error: 'Invalid submission' }, { status: 400 });
    const member = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, uc.courseId), eq(courseMembers.userId, trainerId), eq(courseMembers.role, 'TRAINER')));
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, uc.courseId));
    const isCreator = courseRow ? String(courseRow.createdById) === String(trainerId) : false;
    if (!member.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [row] = await db
      .update(useCaseSubmissions)
      .set({ status, trainerFeedback: trainerFeedback ?? null, reviewedById: trainerId, reviewedAt: new Date() })
      .where(eq(useCaseSubmissions.id, submissionId))
      .returning();

    // Notify trainee about feedback/status
    try {
      if (row?.traineeId) {
        await db.insert(notifications).values({
          userId: String(row.traineeId),
          actorId: trainerId,
          type: 'USE_CASE_FEEDBACK',
          title: 'Feedback zum Use Case',
          message: `Status: ${status}`,
          linkUrl: '/trainee/modules',
          context: { submissionId, useCaseId: String(row.useCaseId) },
        });
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainee for use-case feedback', notifyErr);
    }

    return NextResponse.json({ submission: row });
  } catch (e) {
    console.error('Trainer review use-case PATCH error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
