import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and, ne, sql, inArray } from 'drizzle-orm';
import {
  activityReports,
  profiles,
  activityReportUseCaseEntries,
  trainingUseCases,
} from '@/db/migrations/schemas/schema';
import { apiCache } from '@/lib/api-cache';
import { getTrainingPhase } from '@/lib/ausbildung/duration';
import { normalizePlannedHours } from '@/lib/ausbildung/planned-hours';
import { getISOWeekDates } from '@/lib/date/iso-week';
import {
  getTrainerScope,
  isTraineeVisibleToTrainer,
} from '@/lib/trainer-scope';

// GET: Get a single activity report
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [report] = await db
      .select()
      .from(activityReports)
      .where(eq(activityReports.id, id as any));

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

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

// DELETE: Delete a report (only owner + DRAFT/REJECTED, or trainer)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch report
    const [report] = await db
      .select({
        id: activityReports.id,
        traineeId: activityReports.traineeId,
        status: activityReports.status,
      })
      .from(activityReports)
      .where(eq(activityReports.id, id as any));

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

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

    // Delete related entries first (if not cascading)
    await db
      .delete(activityReportUseCaseEntries)
      .where(eq(activityReportUseCaseEntries.reportId, id as any));

    const [deleted] = await db
      .delete(activityReports)
      .where(eq(activityReports.id, id as any))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    apiCache.invalidate('activity_reports');
    apiCache.invalidate('trainee_dashboard');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in activity-reports DELETE [id]:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    );
  }
}

// PUT: Update a draft report
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      userId,
      weekNumber,
      year,
      ausbildungsjahr,
      periodStart,
      periodEnd,
      entries,
      skillSelfRatings,
      submit,
    } = body;

    // Verify report is draft
    const [report] = await db
      .select()
      .from(activityReports)
      .where(eq(activityReports.id, id as any));

    if (!report)
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });

    // Ownership check: only the report owner can update
    if (userId && String(report.traineeId) !== userId) {
      return NextResponse.json(
        { error: 'Zugriff verweigert' },
        { status: 403 }
      );
    }

    if (report.status !== 'DRAFT' && report.status !== 'REJECTED') {
      return NextResponse.json(
        { error: 'Cannot edit submitted or approved reports' },
        { status: 403 }
      );
    }

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

      // Get planned hours from master data
      const masterUseCases = await db
        .select({
          id: trainingUseCases.id,
          description: trainingUseCases.description,
          plannedHours: trainingUseCases.plannedHours,
        })
        .from(trainingUseCases)
        .where(inArray(trainingUseCases.id, entryUseCaseIds as any));
      plannedMap = new Map(
        masterUseCases.map((uc: any) => [uc.id, normalizePlannedHours(uc)])
      );

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
    const calculatedAusbildungsjahr = traineeProfile?.startOfTrainingDate
      ? getTrainingPhase(
          traineeProfile.startOfTrainingDate,
          traineeProfile.ausbildungDurationYears,
          nextPeriodStart
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

    // Update report fields
    await db
      .update(activityReports)
      .set(updateData)
      .where(eq(activityReports.id, id as any));

    // Update entries: delete old, insert new
    await db
      .delete(activityReportUseCaseEntries)
      .where(eq(activityReportUseCaseEntries.reportId, id as any));

    if (entries && entries.length > 0) {
      await db.insert(activityReportUseCaseEntries).values(
        entries.map((e: any) => ({
          reportId: id,
          useCaseId: e.useCaseId,
          plannedHours: plannedMap.get(e.useCaseId) ?? e.plannedHours ?? 0,
          actualHours: e.actualHours,
          isOverbooked: e.isOverbooked,
          notes: e.notes || null,
          // Grade columns - traineeGrade can be set by trainee, others null until trainer grades
          traineeGrade: e.traineeGrade ? (String(e.traineeGrade) as any) : null,
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

// PATCH: Update report status (for trainer approval/rejection)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { status, feedback, userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const scope = await getTrainerScope(userId);
    if (!scope) {
      return NextResponse.json(
        { error: 'Only trainers can update reports' },
        { status: 403 }
      );
    }

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const [accessRow] = await db
      .select({
        reportId: activityReports.id,
        traineeId: activityReports.traineeId,
        assignedTrainerId: profiles.assignedTrainerId,
        organizationId: profiles.organizationId,
      })
      .from(activityReports)
      .leftJoin(profiles, eq(profiles.id, activityReports.traineeId))
      .where(eq(activityReports.id, id as any));

    if (!accessRow) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (!isTraineeVisibleToTrainer(scope, accessRow)) {
      return NextResponse.json(
        { error: 'Trainee is not assigned to this trainer' },
        { status: 403 }
      );
    }

    const updateData: any = {
      status,
      reviewerId: userId,
      reviewedAt: new Date(),
    };

    if (feedback) {
      updateData.reviewerFeedback = feedback;
    }

    if (status === 'APPROVED') {
      updateData.trainerSignedAt = new Date();
    }

    // H-3 fix: Atomic status check + update (prevents TOCTOU race condition)
    // Only update if the report exists AND is currently in SUBMITTED status
    const [updated] = await db
      .update(activityReports)
      .set(updateData)
      .where(
        and(
          eq(activityReports.id, id as any),
          eq(activityReports.status, 'SUBMITTED')
        )
      )
      .returning();

    if (!updated) {
      // Distinguish between "not found" and "wrong status"
      const [exists] = await db
        .select({ id: activityReports.id, status: activityReports.status })
        .from(activityReports)
        .where(eq(activityReports.id, id as any));

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
