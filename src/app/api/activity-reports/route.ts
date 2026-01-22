import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and } from 'drizzle-orm';
import { activityReports, profiles, activityReportUseCaseEntries } from '@/db/migrations/schemas/schema';

// GET: List activity reports for the current user
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
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
            reviewedAt: r.reviewedAt,
            reviewerFeedback: r.reviewerFeedback,
            traineeSignedAt: r.traineeSignedAt,
            trainerSignedAt: r.trainerSignedAt,
            pdfUrl: r.pdfUrl,
            pdfGeneratedAt: r.pdfGeneratedAt,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        }));

        return NextResponse.json({ reports: formattedReports });
    } catch (error: any) {
        console.error('Error in activity-reports GET:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST: Create a new activity report
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { userId, weekNumber, year, ausbildungsjahr, periodStart, periodEnd, entries, submit } = body;

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }

        // Validate required fields
        if (!weekNumber || !year || !ausbildungsjahr || !entries?.length) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Check for duplicate report (same week/year)
        const [existing] = await db
            .select({ id: activityReports.id })
            .from(activityReports)
            .where(and(
                eq(activityReports.traineeId, userId as any),
                eq(activityReports.weekNumber, weekNumber),
                eq(activityReports.year, year)
            ));

        if (existing) {
            return NextResponse.json({
                error: `Ein Nachweis für KW ${weekNumber}/${year} existiert bereits`
            }, { status: 400 });
        }

        // Calculate period start and end based on week number if not provided
        const calculatePeriodDates = (weekNum: number, yr: number) => {
            const startOfYear = new Date(yr, 0, 1);
            const daysOffset = (weekNum - 1) * 7;
            const start = new Date(startOfYear.getTime() + daysOffset * 86400000);
            const end = new Date(start.getTime() + 6 * 86400000);
            return { start, end };
        };

        const { start: calcStart, end: calcEnd } = calculatePeriodDates(weekNumber, year);
        const startDate = periodStart ? new Date(periodStart) : calcStart;
        const endDate = periodEnd ? new Date(periodEnd) : calcEnd;

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
                    plannedHours: e.plannedHours || 0,
                    actualHours: e.actualHours,
                    isOverbooked: e.isOverbooked || false,
                    notes: e.notes || null,
                }))
            );
        }

        return NextResponse.json({
            success: true,
            reportId: report.id,
            message: submit ? 'Nachweis eingereicht' : 'Entwurf gespeichert'
        });
    } catch (error: any) {
        console.error('Error in activity-reports POST:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
