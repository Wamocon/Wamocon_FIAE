import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { Geschäftsprozesse, gesetzesprozessSubmissions, gesetzesprozessSubmissionLinks, courseMembers } from '@/db/migrations/schemas/schema';

// GET trainee-facing gesetzesprozess detail; include latest submission by trainee
// query: traineeId
export async function GET(req: NextRequest, { params }: { params: Promise<{ gesetzesprozessid: string }> }) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    const { gesetzesprozessid } = await params;
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [g] = await db.select().from(Geschäftsprozesse).where(eq(Geschäftsprozesse.id, gesetzesprozessid as any));
    if (!g || !g.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, g.courseId as any), eq(courseMembers.userId, traineeId as any)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Latest submission by this trainee
    const subs = await db
      .select()
      .from(gesetzesprozessSubmissions)
      .where(and(eq(gesetzesprozessSubmissions.gesetzesprozessId, gesetzesprozessid as any), eq(gesetzesprozessSubmissions.traineeId, traineeId as any)));
    const latest = subs.sort((a, b) => (new Date(b.submittedAt || '').getTime() - new Date(a.submittedAt || '').getTime()))[0];
    let links: { id: string; url: string; description: string | null }[] = [];
    if (latest) {
      links = await db
        .select()
        .from(gesetzesprozessSubmissionLinks)
        .where(eq(gesetzesprozessSubmissionLinks.submissionId, latest.id as any));
    }

    return NextResponse.json({
      gesetzesprozess: { id: g.id, title: g.title, descriptionText: g.descriptionText, isActive: g.isActive, durationValue: g.durationValue, durationUnit: g.durationUnit, activatedAt: g.activatedAt },
      submission: latest
        ? { id: latest.id, submissionText: latest.submissionText, status: latest.status, links, attemptNumber: latest.attemptNumber }
        : null,
    });
  } catch (e) {
    console.error('Trainee gesetzesprozess detail GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
