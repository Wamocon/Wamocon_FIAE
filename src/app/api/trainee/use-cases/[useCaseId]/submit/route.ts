import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { useCases, courseMembers, useCaseSubmissions, useCaseSubmissionLinks, notifications, courses } from '@/db/migrations/schemas/schema';
import { apiCache } from '@/lib/api-cache';
import { getUserOrgId } from '@/lib/auth-helpers';

// POST submit or update a use-case submission
// Body: { traineeId: string, submissionText?: string, links?: Array<{ url: string, description?: string }> }
export async function POST(req: NextRequest, { params }: { params: Promise<{ useCaseId: string }> }) {
  try {
    const { useCaseId } = await params;
    const body = await req.json();
    const traineeId: string | undefined = body?.traineeId;
    const submissionText: string | undefined = body?.submissionText;
    const links: Array<{ url: string; description?: string }> = Array.isArray(body?.links) ? body.links : [];
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const organizationId = await getUserOrgId(traineeId);

    const [u] = await db.select().from(useCases).where(eq(useCases.id, useCaseId as any));
    if (!u || !u.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, u.courseId as any), eq(courseMembers.userId, traineeId as any)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const result = await db.transaction(async (tx) => {
      // Determine next attempt number
      const existing = await tx
        .select()
        .from(useCaseSubmissions)
        .where(and(eq(useCaseSubmissions.useCaseId, useCaseId as any), eq(useCaseSubmissions.traineeId, traineeId as any)));
      const lastAttempt = existing.sort((a, b) => (new Date(b.submittedAt || '').getTime() - new Date(a.submittedAt || '').getTime()))[0];
      const nextAttempt = (lastAttempt?.attemptNumber ?? 0) + 1;
      let submissionId: string;
      if (existing.length) {
        const [updated] = await tx
          .update(useCaseSubmissions)
          .set({ submissionText: submissionText as any, status: 'PENDING' as any, reviewedById: null as any, reviewedAt: null as any, attemptNumber: nextAttempt as any, submittedAt: new Date() as any })
          .where(and(eq(useCaseSubmissions.useCaseId, useCaseId as any), eq(useCaseSubmissions.traineeId, traineeId as any)))
          .returning();
        submissionId = updated.id as any;
        // Replace links
        await tx.delete(useCaseSubmissionLinks).where(eq(useCaseSubmissionLinks.submissionId, submissionId as any));
      } else {
        const [created] = await tx
          .insert(useCaseSubmissions)
          .values({ traineeId: traineeId as any, useCaseId: useCaseId as any, submissionText: submissionText as any, status: 'PENDING' as any, attemptNumber: nextAttempt as any, organizationId })
          .returning();
        submissionId = created.id as any;
      }
      // Insert links
      if (links.length) {
        const values = links
          .filter((l) => l && l.url && String(l.url).trim())
          .map((l) => ({ submissionId: submissionId as any, url: String(l.url).trim(), description: (l.description ?? null) as any }));
        if (values.length) await tx.insert(useCaseSubmissionLinks).values(values);
      }
      return submissionId;
    });

    // Notify trainers
    try {
      const [courseRow] = await db.select().from(courses).where(eq(courses.id, u.courseId as any));
      const trainerMemberRows = await db
        .select({ userId: courseMembers.userId })
        .from(courseMembers)
        .where(and(eq(courseMembers.courseId, u.courseId as any), eq(courseMembers.role, 'TRAINER' as any)));
      const trainerIds = new Set<string>();
      if (courseRow?.createdById) trainerIds.add(String(courseRow.createdById));
      trainerMemberRows.forEach((m) => trainerIds.add(String(m.userId)));
      if (trainerIds.size) {
        const values = Array.from(trainerIds).map((uid) => ({
          userId: uid,
          actorId: traineeId,
          type: 'USE_CASE_SUBMITTED',
          title: 'Use Case eingereicht',
          message: `Ein Trainee hat einen Use Case eingereicht: ${u.title}`,
          linkUrl: '/trainer/reviews?view=usecases&onlyPending=true',
          context: { useCaseId, submissionId: result },
          organizationId,
        }));
        await db.insert(notifications).values(values);
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainers for use-case submission', notifyErr);
    }

    apiCache.invalidate('trainer_reviews');
    apiCache.invalidate('trainee_dashboard');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({ ok: true, submissionId: result });
  } catch (e) {
    console.error('Trainee use-case submit POST error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
