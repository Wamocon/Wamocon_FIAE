import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  notifications,
  profiles,
  quizSubmissions,
  quizzes,
} from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import { apiCache } from '@/lib/api-cache';
import { catalogCondition, requireCatalogScope } from '@/lib/catalog/scope';
import {
  requireTraineeScopeCondition,
  traineeIdInScope,
} from '@/lib/auth/trainee-scope-conditions';
import { isUuid } from '@/lib/uuid';
import { BULK_REVIEW_MAX } from '@/lib/trainer/review-paging';
import {
  QUIZ_REVIEWED_LINK,
  quizReviewedMessage,
  quizzesReviewedMessage,
} from '@/lib/notifications/quiz-reviewed';

// POST /api/trainer/quiz-submissions/bulk-review
// Body: { ids: string[] } (at most 100 uuids)
// Marks the quiz submissions as reviewed in one step (WMCNL-3001), the same as
// PATCH /api/trainer/quiz-submissions/[submissionId] with is_reviewed=true does
// for one. The rights are the ones of that route, checked for every submission
// together: the trainee belongs to the organization of the caller (the super
// admin: every one) and to the chosen occupation (x-catalog), and the quiz lies
// inside the chosen occupation. A submission outside of that is not changed and
// is counted as `skipped`, it is never reported as done (a foreign id answers
// like a missing one). A submission that is reviewed already stays as it is and
// is counted as `alreadyReviewed`, so a second request does the same as the
// first and sends no second notification.
// Every trainee gets one notification for the quizzes that were marked for them
// (the text of the single route for exactly one quiz, a bundled text for more).
export async function POST(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const body = await req.json().catch(() => null);
    const raw: unknown = body?.ids;
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ error: 'ids is required' }, { status: 400 });
    }
    if (raw.length > BULK_REVIEW_MAX) {
      return NextResponse.json(
        { error: `At most ${BULK_REVIEW_MAX} submissions at once` },
        { status: 400 }
      );
    }
    if (!raw.every(isUuid)) {
      return NextResponse.json({ error: 'ids must be uuids' }, { status: 400 });
    }
    const ids = Array.from(new Set(raw.map(id => id.toLowerCase())));

    const catalogScope = await requireCatalogScope(session, req);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;

    // Only the submissions inside the scope are found at all
    const found = await db
      .select({
        id: quizSubmissions.id,
        isReviewed: quizSubmissions.isReviewed,
        quizTitle: quizzes.title,
      })
      .from(quizSubmissions)
      .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
      .where(
        and(
          inArray(quizSubmissions.id, ids as any),
          traineeIdInScope(quizSubmissions.traineeId, traineeScope.condition),
          catalogCondition(quizzes.trainingCatalogId, catalogScope)
        )
      );
    const titleById = new Map(
      found.map(r => [String(r.id), r.quizTitle] as const)
    );
    const open = found.filter(r => !r.isReviewed).map(r => String(r.id));

    // The scope applies to the write as well, not only to the read before it
    const marked = open.length
      ? await db
          .update(quizSubmissions)
          .set({
            isReviewed: true,
            reviewedAt: new Date(),
            reviewedById: session.id as any,
          })
          .where(
            and(
              inArray(quizSubmissions.id, open as any),
              eq(quizSubmissions.isReviewed, false as any),
              traineeIdInScope(
                quizSubmissions.traineeId,
                traineeScope.condition
              )
            )
          )
          .returning({
            id: quizSubmissions.id,
            traineeId: quizSubmissions.traineeId,
            quizId: quizSubmissions.quizId,
            score: quizSubmissions.score,
            trainerFeedback: quizSubmissions.trainerFeedback,
          })
      : [];

    const notified = await notifyTrainees(
      marked,
      titleById,
      String(session.id)
    );

    apiCache.invalidate('trainer_reviews');
    apiCache.invalidate('trainee_quizzes');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({
      ok: true,
      requested: ids.length,
      marked: marked.length,
      alreadyReviewed: found.length - marked.length,
      skipped: ids.length - found.length,
      notified,
      // the ids that are reviewed now, so the page can take them from its list
      reviewedIds: found.map(r => String(r.id)),
    });
  } catch (e) {
    console.error('Trainer quiz submissions bulk review error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

type MarkedRow = {
  id: unknown;
  traineeId: unknown;
  quizId: unknown;
  score: unknown;
  trainerFeedback: unknown;
};

/**
 * One notification "Quiz bewertet" per trainee, in the format of the single
 * route (type, title, link, context), so the bell reads both alike. A failure
 * is logged and never fails the marking, as in the single route. Returns the
 * number of notifications written.
 */
async function notifyTrainees(
  marked: MarkedRow[],
  titleById: Map<string, string | null>,
  actorId: string
): Promise<number> {
  if (marked.length === 0) return 0;
  try {
    const byTrainee = new Map<string, MarkedRow[]>();
    for (const row of marked) {
      const key = String(row.traineeId);
      byTrainee.set(key, [...(byTrainee.get(key) ?? []), row]);
    }
    const traineeIds = Array.from(byTrainee.keys());
    const orgRows = await db
      .select({ id: profiles.id, organizationId: profiles.organizationId })
      .from(profiles)
      .where(inArray(profiles.id, traineeIds as any));
    const orgByTrainee = new Map(
      orgRows.map(r => [String(r.id), r.organizationId] as const)
    );

    const values = [];
    for (const [traineeId, rows] of byTrainee) {
      const organizationId =
        orgByTrainee.get(traineeId) ?? (await getUserOrgId(traineeId));
      const titles = rows.map(r => titleById.get(String(r.id)) ?? null);
      const [first] = rows;
      const single = rows.length === 1;
      values.push({
        userId: traineeId,
        actorId,
        type: 'QUIZ_REVIEWED',
        title: 'Quiz bewertet',
        message: single
          ? quizReviewedMessage({
              quizTitle: titles[0],
              score: first.score as number | null,
              hasFeedback: Boolean(first.trainerFeedback),
            })
          : quizzesReviewedMessage(rows.length, titles),
        linkUrl: QUIZ_REVIEWED_LINK,
        context: single
          ? {
              submissionId: String(first.id),
              quizId: String(first.quizId),
              quizTitle: titles[0],
              score: first.score ?? null,
            }
          : {
              count: rows.length,
              submissionIds: rows.map(r => String(r.id)),
              quizIds: rows.map(r => String(r.quizId)),
              quizTitles: titles,
            },
        organizationId: String(organizationId),
      });
    }
    await db.insert(notifications).values(values as any);
    return values.length;
  } catch (notifyErr) {
    console.warn('Failed to notify trainees for quiz reviews', notifyErr);
    return 0;
  }
}
