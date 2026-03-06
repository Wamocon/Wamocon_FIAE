import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and, sql, inArray, ne } from 'drizzle-orm';
import {
  activityReports,
  profiles,
  activityReportUseCaseEntries,
  trainingUseCases,
} from '@/db/migrations/schemas/schema';
import { apiCache } from '@/lib/api-cache';

// GET: List activity reports for the current user
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const includeOverbooking =
      searchParams.get('includeOverbooking') !== 'false'; // default true

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Get user profile to check role
    const [profile] = await db
      .select({ id: profiles.id, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId as any));

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    let reports;

    // Trainees only see their own reports, trainers see all
    if (profile.role === 'TRAINEE') {
      reports = await db
        .select()
        .from(activityReports)
        .where(eq(activityReports.traineeId, userId as any))
        .orderBy(activityReports.createdAt);
    } else {
      // Trainer sees all reports
      reports = await db
        .select()
        .from(activityReports)
        .orderBy(activityReports.createdAt);
    }

    // Get overbooking status for all reports in one query
    let overbookingMap = new Map<string, boolean>();
    if (includeOverbooking && reports.length > 0) {
      const reportIds = reports.map(r => String(r.id));
      const overbookedEntries = await db
        .select({
          reportId: activityReportUseCaseEntries.reportId,
        })
        .from(activityReportUseCaseEntries)
        .where(
          and(
            inArray(activityReportUseCaseEntries.reportId, reportIds as any),
            eq(activityReportUseCaseEntries.isOverbooked, true)
          )
        );

      overbookedEntries.forEach(e => {
        overbookingMap.set(String(e.reportId), true);
      });
    }

    // Batch-fetch reviewer names for all reports that have a reviewerId
    const reviewerIds = [
      ...new Set(reports.map(r => r.reviewerId).filter(Boolean)),
    ] as string[];
    const reviewerNameMap = new Map<string, string>();
    if (reviewerIds.length > 0) {
      const reviewerProfiles = await db
        .select({ id: profiles.id, fullName: profiles.fullName })
        .from(profiles)
        .where(inArray(profiles.id, reviewerIds as any));
      reviewerProfiles.forEach(p => {
        if (p.fullName) reviewerNameMap.set(String(p.id), p.fullName);
      });
    }

    // Transform to camelCase
    const formattedReports = reports.map(r => ({
      id: r.id,
      traineeId: r.traineeId,
      ausbildungsjahr: r.ausbildungsjahr,
      weekNumber: r.weekNumber,
      year: r.year,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      abteilung: r.abteilung,
      status: r.status,
      submittedAt: r.submittedAt,
      reviewerId: r.reviewerId,
      reviewerName: r.reviewerId
        ? reviewerNameMap.get(String(r.reviewerId)) || null
        : null,
      reviewedAt: r.reviewedAt,
      reviewerFeedback: r.reviewerFeedback,
      traineeSignedAt: r.traineeSignedAt,
      trainerSignedAt: r.trainerSignedAt,
      skillSelfRatings: r.skillSelfRatings || null,
      pdfUrl: r.pdfUrl,
      pdfGeneratedAt: r.pdfGeneratedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      hasOverbooking: overbookingMap.get(String(r.id)) || false,
    }));

    return NextResponse.json(
      { reports: formattedReports },
      {
        headers: {
          'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
        },
      }
    );
  } catch (error: any) {
    console.error('Error in activity-reports GET:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    );
  }
}

// POST: Create a new activity report
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // M-1 fix: Only trainees can create activity reports
    const [creatorProfile] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId as any));

    if (!creatorProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    if (creatorProfile?.role !== 'TRAINEE') {
      return NextResponse.json(
        { error: 'Nur Auszubildende können Nachweise erstellen' },
        { status: 403 }
      );
    }

    // Validate required fields
    if (!weekNumber || !year || !ausbildungsjahr || !entries?.length) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate actualHours are non-negative numbers
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

    // Check for duplicate report (same week/year)
    const [existing] = await db
      .select({ id: activityReports.id })
      .from(activityReports)
      .where(
        and(
          eq(activityReports.traineeId, userId as any),
          eq(activityReports.weekNumber, weekNumber),
          eq(activityReports.year, year)
        )
      );

    if (existing) {
      return NextResponse.json(
        {
          error: `Ein Nachweis für KW ${weekNumber}/${year} existiert bereits`,
        },
        { status: 400 }
      );
    }

    // Calculate period start and end based on week number if not provided
    const calculatePeriodDates = (weekNum: number, yr: number) => {
      const startOfYear = new Date(yr, 0, 1);
      const daysOffset = (weekNum - 1) * 7;
      const start = new Date(startOfYear.getTime() + daysOffset * 86400000);
      const end = new Date(start.getTime() + 6 * 86400000);
      return { start, end };
    };

    const { start: calcStart, end: calcEnd } = calculatePeriodDates(
      weekNumber,
      year
    );
    const startDate = periodStart ? new Date(periodStart) : calcStart;
    const endDate = periodEnd ? new Date(periodEnd) : calcEnd;

    // === Server-side hours validation ===
    // Check that no entry exceeds remaining hours for its use case
    const entryUseCaseIds = entries.map((e: any) => e.useCaseId);

    // Get planned hours from master data
    const masterUseCases = await db
      .select({
        id: trainingUseCases.id,
        plannedHours: trainingUseCases.plannedHours,
      })
      .from(trainingUseCases)
      .where(inArray(trainingUseCases.id, entryUseCaseIds as any));
    const plannedMap = new Map(
      masterUseCases.map((uc: any) => [uc.id, uc.plannedHours])
    );

    // Get already-used hours from all non-rejected reports for this trainee
    const existingReports = await db
      .select({ id: activityReports.id })
      .from(activityReports)
      .where(
        and(
          eq(activityReports.traineeId, userId as any),
          ne(activityReports.status, 'REJECTED')
        )
      );
    const existingReportIds = existingReports.map(r => r.id);

    let usedMap = new Map<string, number>();
    if (existingReportIds.length > 0) {
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
            existingReportIds as any
          )
        )
        .groupBy(activityReportUseCaseEntries.useCaseId);

      usedRows.forEach(row =>
        usedMap.set(row.useCaseId, Number(row.totalUsed) || 0)
      );
    }

    // Validate each entry does not exceed remaining hours
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

    // === Mandatory self-grade validation ===
    // When submitting, every entry must have a traineeGrade (self-assessment)
    if (submit) {
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

    // Create the report
    const [report] = await db
      .insert(activityReports)
      .values({
        traineeId: userId,
        weekNumber,
        year,
        ausbildungsjahr,
        periodStart: startDate,
        periodEnd: endDate,
        skillSelfRatings: skillSelfRatings || null,
        status: submit ? 'SUBMITTED' : 'DRAFT',
        submittedAt: submit ? new Date() : null,
        traineeSignedAt: submit ? new Date() : null,
      })
      .returning();

    // Insert entries into activity_report_use_case_entries
    if (entries && entries.length > 0) {
      await db.insert(activityReportUseCaseEntries).values(
        entries.map((e: any) => ({
          reportId: report.id,
          useCaseId: e.useCaseId,
          plannedHours: plannedMap.get(e.useCaseId) ?? e.plannedHours ?? 0,
          actualHours: e.actualHours,
          isOverbooked: e.isOverbooked || false,
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

    return NextResponse.json({
      success: true,
      reportId: report.id,
      message: submit ? 'Nachweis eingereicht' : 'Entwurf gespeichert',
    });
  } catch (error: any) {
    console.error('Error in activity-reports POST:', error);
    // Return clean error message, never expose raw SQL
    const message =
      error?.message?.includes('duplicate') ||
      error?.message?.includes('already exists')
        ? 'Ein Nachweis für diese Woche existiert bereits'
        : error?.message?.includes('violates') ||
            error?.message?.includes('Failed query')
          ? 'Fehler beim Speichern der Einträge. Bitte versuchen Sie es erneut.'
          : 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
