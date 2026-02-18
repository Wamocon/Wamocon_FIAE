import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { enablers, courseMembers, enablerSubmissions, EnablerSubmission } from '@/db/migrations/schemas/schema';

// GET trainee-facing enabler detail (title, description, ppt, video)
// query: traineeId
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    const { enablerId } = await params;
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [e] = await db.select().from(enablers).where(eq(enablers.id, enablerId));
    if (!e || !e.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, e.courseId), eq(courseMembers.userId, traineeId)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Latest submission by this trainee for the enabler scenario
    const subs: EnablerSubmission[] = await db
      .select()
      .from(enablerSubmissions)
      .where(and(eq(enablerSubmissions.enablerId, enablerId), eq(enablerSubmissions.traineeId, traineeId)));
    const latest = subs.sort((a, b) => (new Date(b.submittedAt || '').getTime() - new Date(a.submittedAt || '').getTime()))[0];

    return NextResponse.json({
      enabler: {
        id: e.id,
        title: e.title,
        descriptionText: e.descriptionText,
        scenarioPdfUrl: e.scenarioPdfUrl,
        pptUrl: e.pptUrl,
        videoUrl: e.videoUrl,
        isActive: e.isActive,
        durationValue: e.durationValue,
        durationUnit: e.durationUnit,
        activatedAt: e.activatedAt,
      },
      submission: latest ? {
        id: latest.id,
        solutionText: latest.solutionText,
        solutions: latest.solutions,
        status: latest.status,
        trainerFeedback: latest.trainerFeedback,
        feedbacks: latest.feedbacks
      } : null,
    });
  } catch (e) {
    console.error('Trainee enabler detail GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
