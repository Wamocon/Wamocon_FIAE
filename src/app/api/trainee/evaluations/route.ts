import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  weeklyEvaluations,
  weeklySoftskillRatings,
  mesSoftskillCriteria,
} from '@/db/migrations/schemas/schema';
import { eq, and, desc } from 'drizzle-orm';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { resolveTraineeForRead } from '@/lib/auth/trainee-data-access';
import {
  requireReportCatalogFilter,
} from '@/lib/auth/activity-report-access';

// GET: Fetch trainee's evaluations
// A trainee gets their own evaluations (a userId in the query is ignored), a
// trainer-level caller gets the ones of a trainee in their organization scope.
// An evaluation belongs to one occupation (weekly_evaluations.training_catalog_id):
// with an occupation chosen (or a trainee in several occupations) only those
// count.
export async function GET(request: NextRequest) {
  const session = await requireUser(request);
  if (isErrorResponse(session)) return session;

  try {
    const { searchParams } = new URL(request.url);
    const resolved = await resolveTraineeForRead(
      session,
      request,
      searchParams.get('userId')
    );
    if (isErrorResponse(resolved)) return resolved;
    const userId = resolved;
    const reportCatalog = await requireReportCatalogFilter(session, request);
    if (isErrorResponse(reportCatalog)) return reportCatalog;

    const cached = await apiCache.getOrFetch(
      `trainee_evaluations_${userId}_${reportCatalog.condition ? reportCatalog.catalogId : 'all'}`,
      async () => {
        const evaluations = await db
          .select()
          .from(weeklyEvaluations)
          .where(
            and(
              eq(weeklyEvaluations.traineeId, userId),
              reportCatalog.evaluationCondition ?? undefined
            )
          )
          .orderBy(
            desc(weeklyEvaluations.year),
            desc(weeklyEvaluations.weekNumber)
          );
        return { evaluations };
      },
      ApiCache.TTL.MEDIUM
    );

    return NextResponse.json(cached, { headers: cacheHeaders.medium });
  } catch (error: unknown) {
    console.error('Error fetching evaluations:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to fetch evaluations', details: msg },
      { status: 500 }
    );
  }
}

// POST: Create or update trainee self-assessment
// Only the session user changes their own self-assessment, a userId in the body
// is ignored.
export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (isErrorResponse(session)) return session;
  const userId = session.id;

  try {
    const body = await request.json();
    const {
      weekNumber,
      year,
      ausbildungsjahr,
      selfRating,
      selfComment,
      submit = false,
    } = body;

    if (!weekNumber || !year || !ausbildungsjahr) {
      return NextResponse.json(
        { error: 'weekNumber, year, and ausbildungsjahr are required' },
        { status: 400 }
      );
    }

    // A trainee in several occupations works in ONE (x-catalog, otherwise the
    // first enrollment): the evaluation of this week is the one of that
    // occupation, never the one of the other occupation
    const reportCatalog = await requireReportCatalogFilter(session, request);
    if (isErrorResponse(reportCatalog)) return reportCatalog;

    // Check if evaluation already exists for this week in this occupation
    const existingEvaluation = await db
      .select()
      .from(weeklyEvaluations)
      .where(
        and(
          eq(weeklyEvaluations.traineeId, userId),
          reportCatalog.catalogId
            ? eq(weeklyEvaluations.trainingCatalogId, reportCatalog.catalogId)
            : undefined,
          eq(weeklyEvaluations.weekNumber, weekNumber),
          eq(weeklyEvaluations.year, year)
        )
      )
      .limit(1);

    let evaluationId: string;

    if (existingEvaluation.length > 0) {
      const existing = existingEvaluation[0];
      if (existing.status === 'APPROVED') {
        return NextResponse.json(
          { error: 'Cannot modify an approved evaluation' },
          { status: 400 }
        );
      }

      const [updated] = await db
        .update(weeklyEvaluations)
        .set({
          selfRating: selfRating || null,
          selfComment: selfComment?.substring(0, 500) || null,
          selfSubmittedAt: submit ? new Date() : existing.selfSubmittedAt,
          status: submit ? 'SUBMITTED' : existing.status,
          updatedAt: new Date(),
        })
        .where(eq(weeklyEvaluations.id, existing.id))
        .returning();

      evaluationId = updated.id;
    } else {
      return NextResponse.json(
        { error: 'Evaluation not found. Please create one first.' },
        { status: 404 }
      );
    }

    // Bust the cached GET so the next read returns fresh data
    apiCache.invalidate('trainee_evaluations');

    return NextResponse.json({
      success: true,
      evaluationId,
      message: submit ? 'Evaluation submitted' : 'Draft saved',
    });
  } catch (error: unknown) {
    console.error('Error saving evaluation:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to save evaluation', details: msg },
      { status: 500 }
    );
  }
}
