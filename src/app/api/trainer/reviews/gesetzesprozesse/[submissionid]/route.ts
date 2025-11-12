import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { courses, courseMembers, Geschäftsprozesse, gesetzesprozessSubmissions, notifications } from '@/db/migrations/schemas/schema';

// Note: dynamic route folder is [submissionid], so the param key is "submissionid" (all lowercase)
export async function PATCH(req: NextRequest, { params }: { params: { submissionid: string } }) {
  try {
    const submissionId = params.submissionid;
    if (!submissionId) return NextResponse.json({ error: 'Missing submissionId' }, { status: 400 });
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    const body = await req.json();
    const status: 'PENDING' | 'APPROVED' | 'REJECTED' | undefined = body?.status;
    const trainerFeedback: string | null | undefined = body?.trainerFeedback ?? undefined;
    if (!status) return NextResponse.json({ error: 'Missing status' }, { status: 400 });

    const [sub] = await db.select().from(gesetzesprozessSubmissions).where(eq(gesetzesprozessSubmissions.id, submissionId));
    if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [gp] = await db.select().from(Geschäftsprozesse).where(eq(Geschäftsprozesse.id, sub.gesetzesprozessId));
    if (!gp) return NextResponse.json({ error: 'Invalid submission' }, { status: 400 });
    const member = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, gp.courseId), eq(courseMembers.userId, trainerId), eq(courseMembers.role, 'TRAINER')));
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, gp.courseId));
    const isCreator = courseRow ? String(courseRow.createdById) === String(trainerId) : false;
    if (!member.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [row] = await db
      .update(gesetzesprozessSubmissions)
      .set({ status, trainerFeedback: trainerFeedback ?? null, reviewedById: trainerId, reviewedAt: new Date() })
      .where(eq(gesetzesprozessSubmissions.id, submissionId))
      .returning();

    // Notify trainee about feedback/status
    try {
      if (row?.traineeId) {
        await db.insert(notifications).values({
          userId: String(row.traineeId),
            actorId: trainerId,
          type: 'GESETZESPROZESS_FEEDBACK',
          title: 'Feedback zum Gesetzesprozess',
          message: `Status: ${status}`,
          linkUrl: '/trainee/modules',
          context: { submissionId, gesetzesprozessId: String(row.gesetzesprozessId) },
        });
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainee for gesetzesprozess feedback', notifyErr);
    }

    return NextResponse.json({ submission: row });
  } catch (e) {
    console.error('Trainer review gesetzesprozess PATCH error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
