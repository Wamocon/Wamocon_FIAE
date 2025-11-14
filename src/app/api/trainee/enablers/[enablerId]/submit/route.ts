import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { enablers, courseMembers, enablerSubmissions, EnablerSubmission, notifications, courses } from '@/db/migrations/schemas/schema';

export async function POST(
  req: NextRequest,
  { params }: { params: { enablerId: string } }
) {
  try {
    const { enablerId } = await params;
    const body = await req.json();
    const traineeId: string | undefined = body?.traineeId;
    const solutionText: string | null = (body?.solutionText ?? null);
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [e] = await db.select().from(enablers).where(eq(enablers.id, enablerId));
    if (!e || !e.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, e.courseId), eq(courseMembers.userId, traineeId)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Upsert-like: if trainee already has a submission, update the latest; else insert
    const existing: EnablerSubmission[] = await db
      .select()
      .from(enablerSubmissions)
      .where(and(eq(enablerSubmissions.enablerId, enablerId), eq(enablerSubmissions.traineeId, traineeId)));

    let saved;
    if (existing.length) {
      const latest = existing.sort((a, b) => (new Date(b.submittedAt || '').getTime() - new Date(a.submittedAt || '').getTime()))[0];
      const [row] = await db
        .update(enablerSubmissions)
        .set({ solutionText, status: 'PENDING', submittedAt: new Date() })
        .where(eq(enablerSubmissions.id, latest.id))
        .returning();
      saved = row;
    } else {
      const [row] = await db
        .insert(enablerSubmissions)
        .values({ enablerId, traineeId, solutionText, status: 'PENDING' })
        .returning();
      saved = row;
    }

    // Notify trainers in this course
    try {
      const [courseRow] = await db.select().from(courses).where(eq(courses.id, e.courseId));
      const trainerMemberRows = await db
        .select({ userId: courseMembers.userId })
        .from(courseMembers)
        .where(and(eq(courseMembers.courseId, e.courseId), eq(courseMembers.role, 'TRAINER')));
      const trainerIds = new Set<string>();
      if (courseRow?.createdById) trainerIds.add(String(courseRow.createdById));
      trainerMemberRows.forEach((m) => trainerIds.add(String(m.userId)));
      if (trainerIds.size) {
        const values = Array.from(trainerIds).map((uid) => ({
          userId: uid,
          actorId: traineeId,
          type: 'ENABLER_SUBMITTED',
          title: 'Szenario eingereicht',
          message: `Ein Trainee hat ein Enabler-Szenario eingereicht: ${e.title}`,
          linkUrl: '/trainer/reviews?type=enabler',
          context: { enablerId, courseId: e.courseId },
        }));
        await db.insert(notifications).values(values);
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainers for enabler submission', notifyErr);
    }

    return NextResponse.json({ submission: { id: saved.id, solutionText: saved.solutionText, status: saved.status } });
  } catch (e) {
    console.error('Trainee enabler submit error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
