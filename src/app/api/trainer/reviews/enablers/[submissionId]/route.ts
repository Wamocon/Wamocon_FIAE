import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import {
  enablers,
  enablerSubmissions,
  notifications,
} from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import { apiCache } from '@/lib/api-cache';
import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import { ensureContentInScope, requireCatalogScope } from '@/lib/catalog/scope';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { submissionId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = session.id;


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

    // The submission has to belong to a trainee the caller is responsible for
    // (own organization, chosen occupation). A foreign one answers like a
    // missing one, so nothing is leaked and nothing is changed.
    const access = await requireTraineeAccess(
      session,
      String(sub.traineeId),
      req,
      'Submission not found'
    );
    if (isErrorResponse(access)) return access;

    // The reviewed content must lie inside the caller's catalogs
    const catalogScope = await requireCatalogScope(session, req);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const deniedEnabler = await ensureContentInScope(
      catalogScope,
      'enabler',
      String(sub.enablerId)
    );
    if (deniedEnabler) return deniedEnabler;

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


    const organizationId = await getUserOrgId(trainerId);

    const [row] = await db
      .update(enablerSubmissions)
      .set({
        status,
        trainerFeedback: feedbacks ? undefined : (trainerFeedback ?? null),
        feedbacks: feedbacks || undefined,
        reviewedById: trainerId,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(enablerSubmissions.id, submissionId),
          eq(enablerSubmissions.traineeId, access.traineeId as any)
        )
      )
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
