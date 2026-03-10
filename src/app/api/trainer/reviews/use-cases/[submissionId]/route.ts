import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import {
  useCases,
  useCaseSubmissions,
  notifications,
} from '@/db/migrations/schemas/schema';
import { verifyTrainer, getUserOrgId } from '@/lib/auth-helpers';
import { apiCache } from '@/lib/api-cache';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const { submissionId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    const body = await req.json();
    const status: 'PENDING' | 'APPROVED' | 'REJECTED' | undefined =
      body?.status;
    const trainerFeedback: string | null | undefined =
      body?.trainerFeedback ?? undefined;

    if (!status) {
      return NextResponse.json({ error: 'Missing status' }, { status: 400 });
    }

    const [sub] = await db
      .select()
      .from(useCaseSubmissions)
      .where(eq(useCaseSubmissions.id, submissionId));
    if (!sub) {
      return NextResponse.json(
        { error: 'Submission not found' },
        { status: 404 }
      );
    }

    const [uc] = await db
      .select()
      .from(useCases)
      .where(eq(useCases.id, sub.useCaseId));
    if (!uc) {
      return NextResponse.json(
        { error: 'Invalid submission' },
        { status: 400 }
      );
    }

    // Shared curriculum: any valid trainer can review submissions
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    const organizationId = await getUserOrgId(trainerId);

    const [row] = await db
      .update(useCaseSubmissions)
      .set({
        status,
        trainerFeedback: trainerFeedback ?? null,
        reviewedById: trainerId,
        reviewedAt: new Date(),
      })
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
          organizationId,
        });
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainee for use-case feedback', notifyErr);
    }

    apiCache.invalidate('trainer_reviews');
    apiCache.invalidate('trainee_dashboard');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({ submission: row });
  } catch (e) {
    console.error('Trainer review use-case PATCH error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
