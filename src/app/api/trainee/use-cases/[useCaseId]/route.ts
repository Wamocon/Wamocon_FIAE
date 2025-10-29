import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { useCases, courseMembers, useCaseSubmissions, useCaseSubmissionLinks } from '@/db/migrations/schemas/schema';

// GET trainee-facing use-case detail; optionally include latest submission by trainee
// query: traineeId
export async function GET(req: NextRequest, { params }: { params: { useCaseId: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    const { useCaseId } = params;
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [u] = await db.select().from(useCases).where(eq(useCases.id, useCaseId as any));
    if (!u || !u.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, u.courseId as any), eq(courseMembers.userId, traineeId as any)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Latest submission by this trainee
    const subs = await db
      .select()
      .from(useCaseSubmissions)
      .where(and(eq(useCaseSubmissions.useCaseId, useCaseId as any), eq(useCaseSubmissions.traineeId, traineeId as any)));
    const latest = subs.sort((a, b) => (new Date(b.submittedAt || '').getTime() - new Date(a.submittedAt || '').getTime()))[0];
    let links: { id: string; url: string; description: string | null }[] = [];
    if (latest) {
      links = await db
        .select()
        .from(useCaseSubmissionLinks)
        .where(eq(useCaseSubmissionLinks.submissionId, latest.id as any));
    }

    return NextResponse.json({
      useCase: { id: u.id, title: u.title, descriptionText: u.descriptionText, isActive: u.isActive, durationValue: u.durationValue, durationUnit: u.durationUnit, activatedAt: u.activatedAt },
      submission: latest
        ? { id: latest.id, submissionText: latest.submissionText, status: latest.status, links }
        : null,
    });
  } catch (e) {
    console.error('Trainee use-case detail GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
