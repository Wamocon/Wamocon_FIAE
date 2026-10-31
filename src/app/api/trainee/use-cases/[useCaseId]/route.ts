import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import {
  useCases,
  courseMembers,
  useCaseSubmissions,
  useCaseSubmissionLinks,
  courses,
  enablers,
} from '@/db/migrations/schemas/schema';
import { requireContentScopeForUser } from '@/lib/catalog/scope';
import { getEnablerProgression } from '@/lib/catalog/progression-db';

// GET trainee-facing use-case detail; optionally include latest submission by trainee
// The data of the session user, a traineeId or userId in the query is ignored.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ useCaseId: string }> }
) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const traineeId = session.id;

  try {
    const { useCaseId } = await params;

    // The content must lie inside the catalog scope of the trainee
    const catalogScope = await requireContentScopeForUser(
      traineeId,
      req,
      'useCase',
      useCaseId
    );
    if (catalogScope instanceof Response) return catalogScope;

    const [u] = await db
      .select()
      .from(useCases)
      .where(eq(useCases.id, useCaseId as any));
    if (!u || !u.isActive)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(
        and(
          eq(courseMembers.courseId, u.courseId as any),
          eq(courseMembers.userId, traineeId as any)
        )
      );
    if (!member)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Latest submission by this trainee
    const subs = await db
      .select()
      .from(useCaseSubmissions)
      .where(
        and(
          eq(useCaseSubmissions.useCaseId, useCaseId as any),
          eq(useCaseSubmissions.traineeId, traineeId as any)
        )
      );
    const latest = subs.sort(
      (a, b) =>
        new Date(b.submittedAt || '').getTime() -
        new Date(a.submittedAt || '').getTime()
    )[0];
    let links: { id: string; url: string; description: string | null }[] = [];
    if (latest) {
      links = await db
        .select()
        .from(useCaseSubmissionLinks)
        .where(eq(useCaseSubmissionLinks.submissionId, latest.id as any));
    }

    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, u.courseId as any));

    // Order of work: the page shows why a use case of a locked enabler can not be handed in
    let lock: {
      reason: string | null;
      lockedBy: { title: string } | null;
    } | null = null;
    if (u.enablerId) {
      const [owner] = await db
        .select({
          id: enablers.id,
          courseId: enablers.courseId,
          isActive: enablers.isActive,
        })
        .from(enablers)
        .where(eq(enablers.id, u.enablerId as any));
      if (owner && owner.isActive) {
        const found = await getEnablerProgression(traineeId, {
          id: String(owner.id),
          courseId: String(owner.courseId),
        });
        if (found?.enabler.locked) {
          lock = {
            reason: found.enabler.lockReason,
            lockedBy: found.enabler.lockedBy
              ? { title: found.enabler.lockedBy.title }
              : null,
          };
        }
      }
    }

    return NextResponse.json({
      lock,
      useCase: {
        id: u.id,
        title: u.title,
        descriptionText: u.descriptionText,
        isActive: u.isActive,
        durationValue: u.durationValue,
        durationUnit: u.durationUnit,
        activatedAt: u.activatedAt,
        courseId: u.courseId,
        courseTitle: course?.title,
      },
      submission: latest
        ? {
            id: latest.id,
            submissionText: latest.submissionText,
            status: latest.status,
            trainerFeedback: latest.trainerFeedback,
            links,
          }
        : null,
    });
  } catch (e) {
    console.error('Trainee use-case detail GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
