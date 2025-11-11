import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { gesetzesprozesse, gesetzesprozessSubmissions, gesetzesprozessSubmissionLinks, courseMembers, notifications, courses } from '@/db/migrations/schemas/schema';

// POST submit a gesetzesprozess submission (creates new attempt or updates with incremented attemptNumber)
// Body: { traineeId: string, submissionText?: string, links?: Array<{ url: string, description?: string }> }
export async function POST(req: NextRequest, { params }: { params: Promise<{ gesetzesprozessid: string }> }) {
  try {
    const { gesetzesprozessid } = await params;
    const body = await req.json();
    const traineeId: string | undefined = body?.traineeId;
    const submissionText: string | undefined = body?.submissionText;
    const links: Array<{ url: string; description?: string }> = Array.isArray(body?.links) ? body.links : [];
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [g] = await db.select().from(gesetzesprozesse).where(eq(gesetzesprozesse.id, gesetzesprozessid as any));
    if (!g || !g.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, g.courseId as any), eq(courseMembers.userId, traineeId as any)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const result = await db.transaction(async (tx) => {
      // Determine next attempt number
      const existing = await tx
        .select()
        .from(gesetzesprozessSubmissions)
        .where(and(eq(gesetzesprozessSubmissions.gesetzesprozessId, gesetzesprozessid as any), eq(gesetzesprozessSubmissions.traineeId, traineeId as any)));
      const lastAttempt = existing.sort((a, b) => (new Date(b.submittedAt || '').getTime() - new Date(a.submittedAt || '').getTime()))[0];
      const nextAttempt = (lastAttempt?.attemptNumber ?? 0) + 1;

      // Create a new submission row per attempt
      const [created] = await tx
        .insert(gesetzesprozessSubmissions)
        .values({ traineeId: traineeId as any, gesetzesprozessId: gesetzesprozessid as any, submissionText: submissionText as any, status: 'PENDING' as any, attemptNumber: nextAttempt })
        .returning();
      const submissionId = created.id as any;

      // Replace any links for previous? We keep per-attempt links; just insert for new
      if (links.length) {
        const values = links
          .filter((l) => l && l.url && String(l.url).trim())
          .map((l) => ({ submissionId: submissionId as any, url: String(l.url).trim(), description: (l.description ?? null) as any }));
        if (values.length) await tx.insert(gesetzesprozessSubmissionLinks).values(values);
      }
      return submissionId;
    });

    // Notify trainers
    try {
      const [courseRow] = await db.select().from(courses).where(eq(courses.id, g.courseId as any));
      const trainerMemberRows = await db
        .select({ userId: courseMembers.userId })
        .from(courseMembers)
        .where(and(eq(courseMembers.courseId, g.courseId as any), eq(courseMembers.role, 'TRAINER' as any)));
      const trainerIds = new Set<string>();
      if (courseRow?.createdById) trainerIds.add(String(courseRow.createdById));
      trainerMemberRows.forEach((m) => trainerIds.add(String(m.userId)));
      if (trainerIds.size) {
        const values = Array.from(trainerIds).map((uid) => ({
          userId: uid,
          actorId: traineeId,
          type: 'GESETZESPROZESS_SUBMITTED',
          title: 'Gesetzesprozess eingereicht',
          message: `Ein Trainee hat einen Gesetzesprozess eingereicht: ${g.title}`,
          linkUrl: '/trainer/reviews?view=gesetzesprozesse&onlyPending=true',
          context: { gesetzesprozessId: gesetzesprozessid, submissionId: result },
        }));
        await db.insert(notifications).values(values);
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainers for gesetzesprozess submission', notifyErr);
    }

    return NextResponse.json({ ok: true, submissionId: result });
  } catch (e) {
    console.error('Trainee gesetzesprozess submit POST error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
