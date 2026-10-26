import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  activityReportUseCaseEntries,
  gradeEditHistory,
  trainingUseCases,
} from '@/db/migrations/schemas/schema';
import { normalizePlannedHours } from '@/lib/ausbildung/planned-hours';
import {
  isErrorResponse,
  requireTrainer,
  requireUser,
} from '@/lib/auth/session';
import {
  entryAccessCondition,
  GRADABLE_STATUSES,
  loadReportForSession,
  notGradable,
  UUID,
} from '@/lib/auth/activity-report-access';
import {
  MAX_COMMENT_LENGTH,
  MAX_REASON_LENGTH,
  invalidText,
  readJsonObject,
} from '@/lib/input-limits';

/** Most grades one request may carry (a report has a few dozen entries). */
const MAX_ENTRY_GRADES = 200;

// GET: Get report entries for a specific report
// A trainee reaches the entries of their own reports, trainer level the ones of
// submitted reports of trainees inside its organization scope.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(request);
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await params;

    const report = await loadReportForSession(session, request, id);
    if (isErrorResponse(report)) return report;

    const entries = await db
      .select({
        id: activityReportUseCaseEntries.id,
        reportId: activityReportUseCaseEntries.reportId,
        useCaseId: activityReportUseCaseEntries.useCaseId,
        plannedHours: activityReportUseCaseEntries.plannedHours,
        actualHours: activityReportUseCaseEntries.actualHours,
        isOverbooked: activityReportUseCaseEntries.isOverbooked,
        notes: activityReportUseCaseEntries.notes,
        traineeGrade: activityReportUseCaseEntries.traineeGrade,
        trainerGrade: activityReportUseCaseEntries.trainerGrade,
        releaseGrade: activityReportUseCaseEntries.releaseGrade,
        gradeComment: activityReportUseCaseEntries.gradeComment,
        releaseGradeComment: activityReportUseCaseEntries.releaseGradeComment,
        isGradeApproved: activityReportUseCaseEntries.isGradeApproved,
        gradeApprovedAt: activityReportUseCaseEntries.gradeApprovedAt,
        releaseGradeAt: activityReportUseCaseEntries.releaseGradeAt,
        createdAt: activityReportUseCaseEntries.createdAt,
        updatedAt: activityReportUseCaseEntries.updatedAt,
        useCaseDescription: trainingUseCases.description,
      })
      .from(activityReportUseCaseEntries)
      .leftJoin(
        trainingUseCases,
        eq(activityReportUseCaseEntries.useCaseId, trainingUseCases.id)
      )
      .where(eq(activityReportUseCaseEntries.reportId, id as any))
      .orderBy(activityReportUseCaseEntries.createdAt);

    const formattedEntries = entries.map(e => ({
      id: e.id,
      reportId: e.reportId,
      useCaseId: e.useCaseId,
      plannedHours: normalizePlannedHours({
        plannedHours: e.plannedHours,
      }),
      actualHours: e.actualHours,
      isOverbooked: e.isOverbooked,
      notes: e.notes,
      traineeGrade: e.traineeGrade,
      trainerGrade: e.trainerGrade,
      releaseGrade: e.releaseGrade,
      gradeComment: e.gradeComment,
      releaseGradeComment: e.releaseGradeComment,
      isGradeApproved: e.isGradeApproved,
      gradeApprovedAt: e.gradeApprovedAt,
      releaseGradeAt: e.releaseGradeAt,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));

    return NextResponse.json({ entries: formattedEntries });
  } catch (error: any) {
    // If table doesn't exist yet, return empty entries
    if (error?.cause?.code === '42P01') {
      console.warn(
        'Table activity_report_use_case_entries does not exist yet - returning empty entries'
      );
      return NextResponse.json({ entries: [] });
    }
    console.error('Error in report entries GET:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    );
  }
}

// PATCH: Update grades for report entries
// Trainer level only, for reports of trainees inside its organization scope.
// The grading person is the session user, a trainerId in the body is ignored.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireTrainer(request);
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await params;
    const body = await readJsonObject(request);
    if (isErrorResponse(body)) return body;
    const { entryGrades, editReason } = body as Record<string, any>;

    // entryGrades: Array of { entryId, grade, comment }
    if (!entryGrades || !Array.isArray(entryGrades)) {
      return NextResponse.json(
        { error: 'entryGrades array required' },
        { status: 400 }
      );
    }

    // Shape and length of what goes into the database, checked before anything
    // is read: a report has a few dozen entries, the limit only stops a runaway
    // request
    if (entryGrades.length > MAX_ENTRY_GRADES) {
      return NextResponse.json(
        { error: 'Too many entryGrades' },
        { status: 400 }
      );
    }
    if (
      entryGrades.some(g => !g || typeof g !== 'object' || Array.isArray(g))
    ) {
      return NextResponse.json(
        { error: 'Invalid entryGrades' },
        { status: 400 }
      );
    }
    const invalidTextInput =
      invalidText('editReason', editReason, MAX_REASON_LENGTH) ??
      entryGrades
        .map(g => invalidText('comment', g.comment, MAX_COMMENT_LENGTH))
        .find(Boolean);
    if (invalidTextInput) return invalidTextInput;

    // H-2 fix: Validate all trainer grades are in valid range
    const validGrades = ['1', '2', '3', '4', '5', '6'];
    const invalidGrades = entryGrades.filter(
      (g: any) => g.grade && !validGrades.includes(String(g.grade))
    );
    if (invalidGrades.length > 0) {
      return NextResponse.json(
        { error: 'Noten müssen zwischen 1 und 6 liegen.' },
        { status: 400 }
      );
    }

    const report = await loadReportForSession(session, request, id);
    if (isErrorResponse(report)) return report;
    const refused = notGradable(report);
    if (refused) return refused;

    const gradeList = entryGrades.filter((g: any) => g?.entryId && g.grade);

    // H-1 fix: Every entry has to belong to the report in the URL (prevent
    // IDOR). Checked for all entries before the first one is written.
    const entryIds: string[] = gradeList.map((g: any) => String(g.entryId));
    const notOurs = () =>
      NextResponse.json(
        { error: 'Eintrag gehört nicht zu diesem Nachweis' },
        { status: 403 }
      );
    if (entryIds.some(entryId => !UUID.test(entryId))) return notOurs();

    const existingEntries =
      entryIds.length > 0
        ? await db
            .select()
            .from(activityReportUseCaseEntries)
            .where(
              and(
                eq(activityReportUseCaseEntries.reportId, id as any),
                inArray(activityReportUseCaseEntries.id, entryIds as any)
              )
            )
        : [];
    const existingById = new Map(existingEntries.map(e => [String(e.id), e]));
    if (entryIds.some(entryId => !existingById.has(entryId))) return notOurs();

    const now = new Date();
    const updatedEntries = await db.transaction(async tx => {
      const updatedRows = [];
      for (const gradeData of gradeList) {
        const { entryId, grade, comment } = gradeData;
        const existing = existingById.get(String(entryId))!;

        // The report, its status and the organization of the caller are part
        // of the update
        const updated = await tx
          .update(activityReportUseCaseEntries)
          .set({
            trainerGrade: String(grade) as any,
            gradeComment: comment || null,
            isGradeApproved: true,
            gradeApprovedAt: now,
            gradeApprovedBy: session.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(activityReportUseCaseEntries.id, entryId as any),
              eq(activityReportUseCaseEntries.reportId, id as any),
              entryAccessCondition(session, GRADABLE_STATUSES)
            )
          )
          .returning();

        // Log edit history if grade is being changed (not first-time set),
        // only for a grade that was really written
        if (
          updated.length > 0 &&
          existing.trainerGrade &&
          existing.trainerGrade !== String(grade)
        ) {
          await tx.insert(gradeEditHistory).values({
            entityType: 'USE_CASE_ENTRY',
            entityId: entryId,
            fieldName: 'trainerGrade',
            oldValue: existing.trainerGrade,
            newValue: String(grade),
            changedBy: session.id,
            changeReason: editReason || null,
          });
        }

        if (updated.length > 0) updatedRows.push(updated[0]);
      }
      return updatedRows;
    });

    return NextResponse.json({
      success: true,
      updatedCount: updatedEntries.length,
      entries: updatedEntries,
    });
  } catch (error: any) {
    console.error('Error in report entries PATCH:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    );
  }
}
