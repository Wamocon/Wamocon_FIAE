import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  activityReports,
  activityReportUseCaseEntries,
  gradeEditHistory,
  profiles,
  weeklyEvaluations,
  weeklySoftskillRatings,
} from '@/db/migrations/schemas/schema';
import { eq, and, desc } from 'drizzle-orm';
import { isErrorResponse, requireTrainer } from '@/lib/auth/session';
import { UUID } from '@/lib/auth/activity-report-access';
import { resolveTraineeForRead } from '@/lib/auth/trainee-data-access';

const notFound = () =>
  NextResponse.json({ error: 'Not found' }, { status: 404 });

/** The trainee a graded record belongs to, or null if there is no such record. */
async function traineeOfEntity(entityType: string, entityId: string) {
  if (entityType === 'USE_CASE_ENTRY') {
    const [row] = await db
      .select({ traineeId: activityReports.traineeId })
      .from(activityReportUseCaseEntries)
      .innerJoin(
        activityReports,
        eq(activityReportUseCaseEntries.reportId, activityReports.id)
      )
      .where(eq(activityReportUseCaseEntries.id, entityId as any))
      .limit(1);
    return row ? String(row.traineeId) : null;
  }
  if (entityType === 'WEEKLY_EVALUATION') {
    const [row] = await db
      .select({ traineeId: weeklyEvaluations.traineeId })
      .from(weeklyEvaluations)
      .where(eq(weeklyEvaluations.id, entityId as any))
      .limit(1);
    return row ? String(row.traineeId) : null;
  }
  const [row] = await db
    .select({ traineeId: weeklyEvaluations.traineeId })
    .from(weeklySoftskillRatings)
    .innerJoin(
      weeklyEvaluations,
      eq(weeklySoftskillRatings.weeklyEvaluationId, weeklyEvaluations.id)
    )
    .where(eq(weeklySoftskillRatings.id, entityId as any))
    .limit(1);
  return row ? String(row.traineeId) : null;
}

const ENTITY_TYPES = [
  'USE_CASE_ENTRY',
  'WEEKLY_EVALUATION',
  'SOFTSKILL_RATING',
];

/**
 * GET /api/grade-edit-history?entityType=...&entityId=...
 *
 * Returns the audit trail of grade changes for a specific entity.
 * Used by trainers to view the history of grade modifications. Trainer level
 * only, and only for a record of a trainee inside the organization scope (and
 * the chosen occupation) of the caller, everything else is a 404.
 */
export async function GET(request: NextRequest) {
  const session = await requireTrainer(request);
  if (isErrorResponse(session)) return session;

  try {
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: 'entityType and entityId are required' },
        { status: 400 }
      );
    }
    if (!ENTITY_TYPES.includes(entityType)) {
      return NextResponse.json(
        { error: 'Unsupported entityType' },
        { status: 400 }
      );
    }
    if (!UUID.test(entityId)) return notFound();

    const traineeId = await traineeOfEntity(entityType, entityId);
    if (!traineeId) return notFound();
    const scoped = await resolveTraineeForRead(session, request, traineeId);
    if (isErrorResponse(scoped)) {
      return scoped.status === 404 ? notFound() : scoped;
    }

    const history = await db
      .select({
        id: gradeEditHistory.id,
        entityType: gradeEditHistory.entityType,
        entityId: gradeEditHistory.entityId,
        fieldName: gradeEditHistory.fieldName,
        oldValue: gradeEditHistory.oldValue,
        newValue: gradeEditHistory.newValue,
        changedBy: gradeEditHistory.changedBy,
        changeReason: gradeEditHistory.changeReason,
        changedAt: gradeEditHistory.createdAt,
        changerName: profiles.fullName,
      })
      .from(gradeEditHistory)
      .leftJoin(profiles, eq(gradeEditHistory.changedBy, profiles.id))
      .where(
        and(
          eq(gradeEditHistory.entityType, entityType),
          eq(gradeEditHistory.entityId, entityId)
        )
      )
      .orderBy(desc(gradeEditHistory.createdAt));

    return NextResponse.json({ history });
  } catch (error) {
    console.error('Error fetching grade edit history:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    );
  }
}
