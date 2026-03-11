import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import {
  enablers,
  enablerSubmissions,
  notifications,
} from '@/db/migrations/schemas/schema';
import { verifyTrainer, getUserOrgId, verifyPlatformOwner } from '@/lib/auth-helpers';
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
    const feedbacks:
      | Array<{ scenarioIndex: number; feedback: string }>
      | undefined = body?.feedbacks;

    if (!status) {
      return NextResponse.json({ error: 'Missing status' }, { status: 400 });
    }

    const [sub] = await db
      .select()
      .from(enablerSubmissions)
      .where(eq(enablerSubmissions.id, submissionId));
    if (!sub) {
      return NextResponse.json(
        { error: 'Submission not found' },
        { status: 404 }
      );
    }

    const [en] = await db
      .select({ id: enablers.id })
      .from(enablers)
      .where(eq(enablers.id, sub.enablerId));
    if (!en) {
      return NextResponse.json(
        { error: 'Invalid submission' },
        { status: 400 }
      );
    }

    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    const organizationId = await getUserOrgId(trainerId);
    const isPO = await verifyPlatformOwner(trainerId);
    if (!isPO && sub.traineeId) {
      const traineeOrgId = await getUserOrgId(String(sub.traineeId));
      if (organizationId !== traineeOrgId) {
        return NextResponse.json(
          { error: 'Trainee not in your organization' },
          { status: 403 }
        );
      }
    }

    const [row] = await db
      .update(enablerSubmissions)
      .set({
        status,
        trainerFeedback: feedbacks ? undefined : (trainerFeedback ?? null),
        feedbacks: feedbacks || undefined,
        reviewedById: trainerId,
        reviewedAt: new Date(),
      })
      .where(eq(enablerSubmissions.id, submissionId))
      .returning();

    // Notify trainee about feedback/status
    try {
      if (row?.traineeId) {
        await db.insert(notifications).values({
          userId: String(row.traineeId),
          actorId: trainerId,
          type: 'ENABLER_FEEDBACK',
          title: 'Feedback zum Enabler',
          message: `Status: ${status}`,
          linkUrl: '/trainee/modules',
          context: { submissionId, enablerId: String(row.enablerId) },
          organizationId,
        });
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainee for enabler feedback', notifyErr);
    }

    apiCache.invalidate('trainer_reviews');
    apiCache.invalidate('trainee_dashboard');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({ submission: row });
  } catch (e) {
    console.error('Trainer review enabler PATCH error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
