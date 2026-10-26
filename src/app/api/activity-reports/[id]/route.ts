import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and, ne, sql, inArray } from 'drizzle-orm';
import {
  activityReports,
  profiles,
  activityReportUseCaseEntries,
  trainingComponents,
  trainingUseCases,
} from '@/db/migrations/schemas/schema';
import { apiCache } from '@/lib/api-cache';
import { getTrainingPhase } from '@/lib/ausbildung/duration';
import { normalizePlannedHours } from '@/lib/ausbildung/planned-hours';
import { getISOWeekDates } from '@/lib/date/iso-week';
import {
  isErrorResponse,
  requireTrainer,
  requireUser,
} from '@/lib/auth/session';
import {
  entryAccessCondition,
  loadReportForSession,
  requireTraineeSession,
  traineeAccessCondition,
} from '@/lib/auth/activity-report-access';
import {
  allowedCatalogCondition,
  requireCatalogScope,
} from '@/lib/catalog/scope';
import { loadPhasePlan } from '@/lib/catalog/phase-plan-db';

// GET: Get a single activity report
// A trainee reaches their own reports, trainer level the submitted reports of
// trainees inside its organization scope. Everything else is a 404.
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

    // Fetch reviewer name if report has a reviewer
    let reviewerName: string | null = null;
    if (report.reviewerId) {
      const [reviewer] = await db
        .select({ fullName: profiles.fullName })
        .from(profiles)
        .where(eq(profiles.id, report.reviewerId as any));
      reviewerName = reviewer?.fullName || null;
    }

    return NextResponse.json({
      report: {
        id: report.id,
        traineeId: report.traineeId,
        ausbildungsjahr: report.ausbildungsjahr,
        weekNumber: report.weekNumber,
        year: report.year,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        status: report.status,
        submittedAt: report.submittedAt,
        reviewerId: report.reviewerId,
        reviewerName,
        reviewedAt: report.reviewedAt,
        reviewerFeedback: report.reviewerFeedback,
        traineeSignedAt: report.traineeSignedAt,
        trainerSignedAt: report.trainerSignedAt,
        createdAt: report.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Error in activity-reports GET [id]:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    );
  }
}

// DELETE: Delete a report. A trainee deletes their own draft or rejected
// report, trainer level a submitted or rejected report inside its organization
// scope. An approved report is never deleted (BBiG §14).
class NotDeletable extends Error {}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(request);
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await params;

    const report = await loadReportForSession(session, request, id);
    if (isErrorResponse(report)) return report;

    // M-3 fix: Cannot delete APPROVED reports (BBiG §14 record-keeping)
    if (report.status === 'APPROVED') {
      return NextResponse.json(
        {
          error:
            'Genehmigte Nachweise können nicht gelöscht werden (BBiG §14 Aufbewahrungspflicht)',
        },
        { status: 403 }
      );
    }

    const deletable = session.isTrainerLevel
      ? ['SUBMITTED', 'REJECTED']
      : ['DRAFT', 'REJECTED'];
    if (!deletable.includes(String(report.status))) {
      return NextResponse.json(
        { error: 'Eingereichte Nachweise können nicht gelöscht werden' },
        { status: 403 }
      );
    }

    // Owner or organization and the status are part of the delete itself. The
    // entries go first (not every database cascades), and stay if the report
    // cannot be deleted any more.
    await db.transaction(async tx => {
      await tx
        .delete(activityReportUseCaseEntries)
        .where(
          and(
            eq(activityReportUseCaseEntries.reportId, id as any),
            entryAccessCondition(session)
          )
        );

      const [deleted] = await tx
        .delete(activityReports)
        .where(
          and(
            eq(activityReports.id, id as any),
            traineeAccessCondition(session, activityReports.traineeId),
            inArray(activityReports.status, deletable as any)
          )
        )
        .returning({ id: activityReports.id });

      if (!deleted) throw new NotDeletable();
    });

    apiCache.invalidate('activity_reports');
    apiCache.invalidate('trainee_dashboard');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof NotDeletable) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    console.error('Error in activity-reports DELETE [id]:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    );
  }
}

// PUT: Update a draft or rejected report of the signed-in trainee (a userId
// in the body is ignored, the report of someone else is a 404)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireTraineeSession(request);
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await params;
    const body = await request.json();
    const {
      weekNumber,
      year,
      ausbildungsjahr,
      periodStart,
      periodEnd,
      entries,
      skillSelfRatings,
      submit,
    } = body;

    // Verify report is the caller's own
    const report = await loadReportForSession(session, request, id);
    if (isErrorResponse(report)) return report;

    if (report.status !== 'DRAFT' && report.status !== 'REJECTED') {
      return NextResponse.json(
        { error: 'Cannot edit submitted or approved reports' },
        { status: 403 }
      );
    }

    // Occupation of the report owner: use cases and the phase plan follow it
    const catalogScope = await requireCatalogScope(session, request);
    if (catalogScope instanceof Response) return catalogScope;

    // Validate actualHours are non-negative numbers
    if (entries && entries.length > 0) {
      const invalidHours = entries.filter(
        (e: any) => typeof e.actualHours !== 'number' || e.actualHours < 0
      );
      if (invalidHours.length > 0) {
        return NextResponse.json(
          { error: 'IST-Stunden müssen positive Zahlen sein (≥ 0).' },
          { status: 400 }
        );
      }

      // Validate traineeGrade range if provided
      const validGrades = ['1', '2', '3', '4', '5', '6'];
      const invalidGrades = entries.filter(
        (e: any) =>
          e.traineeGrade && !validGrades.includes(String(e.traineeGrade))
      );
      if (invalidGrades.length > 0) {
        return NextResponse.json(
          { error: 'Selbstbewertung muss eine Note von 1 bis 6 sein.' },
          { status: 400 }
        );
      }
    }

    // === Server-side hours validation ===
    let plannedMap = new Map<string, number>();
    if (entries && entries.length > 0) {
      const entryUseCaseIds = entries.map((e: any) => e.useCaseId);

      // Get planned hours from master data (only use cases of the owner's
      // occupation count)
      const masterUseCases = await db
        .select({
          id: trainingUseCases.id,
          description: trainingUseCases.description,
          plannedHours: trainingUseCases.plannedHours,
        })
        .from(trainingUseCases)
        .innerJoin(
          trainingComponents,
          eq(trainingUseCases.componentId, trainingComponents.id)
        )
        .where(
          and(
            inArray(trainingUseCases.id, entryUseCaseIds as any),
            allowedCatalogCondition(
              trainingComponents.trainingCatalogId,
              catalogScope
            )
          )
        );
      plannedMap = new Map(
        masterUseCases.map((uc: any) => [uc.id, normalizePlannedHours(uc)])
      );
      if (entryUseCaseIds.some((id: string) => !plannedMap.has(id))) {
        return NextResponse.json(
          { error: 'Unbekannte Tätigkeit im Nachweis.' },
          { status: 400 }
        );
      }

      // Get already-used hours from all non-rejected reports EXCLUDING this one
      const otherReports = await db
        .select({ id: activityReports.id })
        .from(activityReports)
        .where(
          and(
            eq(activityReports.traineeId, report.traineeId as any),
            ne(activityReports.status, 'REJECTED'),
            ne(activityReports.id, id as any)
          )
        );
      const otherReportIds = otherReports.map(r => r.id);

      let usedMap = new Map<string, number>();
      if (otherReportIds.length > 0) {
        const usedRows = await db
          .select({
            useCaseId: activityReportUseCaseEntries.useCaseId,
            totalUsed:
              sql<number>`COALESCE(SUM(${activityReportUseCaseEntries.actualHours}), 0)`.as(
                'total_used'
              ),
          })
          .from(activityReportUseCaseEntries)
          .where(
            inArray(
              activityReportUseCaseEntries.reportId,
              otherReportIds as any
            )
          )
          .groupBy(activityReportUseCaseEntries.useCaseId);

        usedRows.forEach(row =>
          usedMap.set(row.useCaseId, Number(row.totalUsed) || 0)
        );
      }

      // Validate each entry
      const violations: string[] = [];
      for (const entry of entries) {
        const totalHours = plannedMap.get(entry.useCaseId) ?? 0;
        const usedHours = usedMap.get(entry.useCaseId) ?? 0;
        const remaining = totalHours - usedHours;
        if (entry.actualHours > remaining) {
          violations.push(
            `Tätigkeit überschreitet verfügbare Stunden: ${entry.actualHours} Std. eingetragen, aber nur ${remaining.toFixed(1)} Std. von ${totalHours} Std. verfügbar.`
          );
        }
      }
      if (violations.length > 0) {
        return NextResponse.json(
          {
            error: violations[0],
            violations,
          },
          { status: 400 }
        );
      }

      // === 40h/week maximum validation (JArbSchG / BBiG compliance) ===
      const totalWeeklyHours = entries.reduce(
        (sum: number, e: any) => sum + (Number(e.actualHours) || 0),
        0
      );
      if (totalWeeklyHours > 40) {
        return NextResponse.json(
          {
            error: `Maximale Wochenstunden überschritten: ${totalWeeklyHours} Std. eingetragen, aber maximal 40 Std. pro Woche zulässig (§ 8 JArbSchG).`,
          },
          { status: 400 }
        );
      }
    }

    // === Mandatory self-grade validation ===
    // When submitting, every entry must have a traineeGrade (self-assessment)
    if (submit && entries && entries.length > 0) {
      const missingGrades = entries.filter((e: any) => !e.traineeGrade);
      if (missingGrades.length > 0) {
        return NextResponse.json(
          {
            error: `Bitte bewerten Sie alle Tätigkeiten mit einer Selbsteinschätzung (Note 1-6), bevor Sie den Nachweis einreichen. ${missingGrades.length} Einträge ohne Selbstbewertung.`,
          },
          { status: 400 }
        );
      }
    }

    const reportWeekNumber = Number(weekNumber);
    const reportYear = Number(year);
    if (
      !Number.isInteger(reportWeekNumber) ||
      reportWeekNumber < 1 ||
      reportWeekNumber > 53 ||
      !Number.isInteger(reportYear) ||
      reportYear < 2000
    ) {
      return NextResponse.json(
        { error: 'Bitte geben Sie eine gÃ¼ltige Kalenderwoche und Jahr an.' },
        { status: 400 }
      );
    }

    const calculatedPeriod = getISOWeekDates(reportWeekNumber, reportYear);
    const nextPeriodStart = periodStart
      ? new Date(periodStart)
      : calculatedPeriod.start;
    const nextPeriodEnd = periodEnd ? new Date(periodEnd) : calculatedPeriod.end;
    const [traineeProfile] = await db
      .select({
        startOfTrainingDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
      })
      .from(profiles)
      .where(eq(profiles.id, report.traineeId as any));
    const phasePlan = traineeProfile?.startOfTrainingDate
      ? await loadPhasePlan(
          catalogScope.activeCatalogId,
          traineeProfile.ausbildungDurationYears
        )
      : null;
    const calculatedAusbildungsjahr = traineeProfile?.startOfTrainingDate
      ? getTrainingPhase(
          traineeProfile.startOfTrainingDate,
          traineeProfile.ausbildungDurationYears,
          nextPeriodStart,
          phasePlan?.phaseMonths[0]
        )
      : Number(ausbildungsjahr) || report.ausbildungsjahr;

    // Build update data - clear previous reviewer data if resubmitting a rejected report
    const updateData: Record<string, any> = {
      weekNumber: reportWeekNumber,
      year: reportYear,
      ausbildungsjahr: calculatedAusbildungsjahr,
      periodStart: nextPeriodStart,
      periodEnd: nextPeriodEnd,
      skillSelfRatings: skillSelfRatings || null,
      status: submit ? 'SUBMITTED' : 'DRAFT',
      submittedAt: submit ? new Date() : null,
      traineeSignedAt: submit ? new Date() : null,
      updatedAt: new Date(),
    };

    // Clear reviewer feedback when resubmitting
    if (submit && report.status === 'REJECTED') {
      updateData.reviewerFeedback = null;
      updateData.reviewerId = null;
      updateData.reviewedAt = null;
      updateData.trainerSignedAt = null;
    }

    // The owner and the status are part of the update itself, so a report
    // that was submitted in the meantime is not touched. The entries are only
    // replaced if the update took place.
    const updated = await db.transaction(async tx => {
      const [row] = await tx
        .update(activityReports)
        .set(updateData)
        .where(
          and(
            eq(activityReports.id, id as any),
            eq(activityReports.traineeId, session.id as any),
            inArray(activityReports.status, ['DRAFT', 'REJECTED'])
          )
        )
        .returning({ id: activityReports.id });
      if (!row) return false;

      // Update entries: delete old, insert new
      await tx
        .delete(activityReportUseCaseEntries)
        .where(eq(activityReportUseCaseEntries.reportId, id as any));

      if (entries && entries.length > 0) {
        await tx.insert(activityReportUseCaseEntries).values(
          entries.map((e: any) => ({
            reportId: id,
            useCaseId: e.useCaseId,
            plannedHours: plannedMap.get(e.useCaseId) ?? e.plannedHours ?? 0,
            actualHours: e.actualHours,
            isOverbooked: e.isOverbooked,
            notes: e.notes || null,
            // Grade columns - traineeGrade can be set by trainee, others null until trainer grades
            traineeGrade: e.traineeGrade
              ? (String(e.traineeGrade) as any)
              : null,
            trainerGrade: null,
            releaseGrade: null,
            gradeComment: null,
            releaseGradeComment: null,
            isGradeApproved: false,
            gradeApprovedAt: null,
            gradeApprovedBy: null,
            releaseGradeAt: null,
            releaseGradeBy: null,
          }))
        );
      }
      return true;
    });

    if (!updated) {
      return NextResponse.json(
        { error: 'Cannot edit submitted or approved reports' },
        { status: 403 }
      );
    }

    apiCache.invalidate('activity_reports');
    apiCache.invalidate('trainee_dashboard');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in activity-reports PUT [id]:', error);
    const message =
      error?.message?.includes('violates') ||
      error?.message?.includes('Failed query')
        ? 'Fehler beim Speichern der Einträge. Bitte versuchen Sie es erneut.'
        : 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH: Update report status (trainer level approves or rejects a submitted
// report inside its organization scope). The reviewer is the session user.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireTrainer(request);
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await params;

    // Handle empty body gracefully (can happen with preflight or browser issues)
    let body;
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { status, feedback } = body;

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const report = await loadReportForSession(session, request, id);
    if (isErrorResponse(report)) return report;

    const updateData: any = {
      status,
      reviewerId: session.id,
      reviewedAt: new Date(),
    };

    if (feedback) {
      updateData.reviewerFeedback = feedback;
    }

    if (status === 'APPROVED') {
      updateData.trainerSignedAt = new Date();
    }

    // H-3 fix: Atomic status check + update (prevents TOCTOU race condition)
    // Only update if the report is currently in SUBMITTED status and the
    // trainee lies inside the organization scope of the caller
    const [updated] = await db
      .update(activityReports)
      .set(updateData)
      .where(
        and(
          eq(activityReports.id, id as any),
          eq(activityReports.status, 'SUBMITTED'),
          traineeAccessCondition(session, activityReports.traineeId)
        )
      )
      .returning();

    if (!updated) {
      // Distinguish between "not found" and "wrong status"
      const [exists] = await db
        .select({ id: activityReports.id, status: activityReports.status })
        .from(activityReports)
        .where(
          and(
            eq(activityReports.id, id as any),
            traineeAccessCondition(session, activityReports.traineeId)
          )
        );

      if (!exists) {
        return NextResponse.json(
          { error: 'Report not found' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        {
          error: `Nur eingereichte Nachweise können genehmigt/abgelehnt werden. Aktueller Status: ${exists.status}`,
        },
        { status: 400 }
      );
    }

    apiCache.invalidate('activity_reports');
    apiCache.invalidate('trainee_dashboard');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({
      success: true,
      report: updated,
      message:
        status === 'APPROVED' ? 'Nachweis genehmigt' : 'Nachweis abgelehnt',
    });
  } catch (error: any) {
    console.error('Error in activity-reports PATCH [id]:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    );
  }
}
