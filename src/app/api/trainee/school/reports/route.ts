/**
 * Activity Reports (Tätigkeitsnachweis) API
 * 
 * GET  /api/trainee/school/reports - List reports for trainee
 * POST /api/trainee/school/reports - Create new weekly report
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
    activityReports,
    activityReportEntries,
    profiles
} from '@/db/migrations/schemas/schema';

// Helper to get ISO week number
function getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Helper to get week start/end dates
function getWeekDates(weekNumber: number, year: number): { start: Date; end: Date } {
    // Get January 4th (always in week 1)
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;

    // Get Monday of week 1
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - dayOfWeek + 1);

    // Calculate target week's Monday
    const targetMonday = new Date(week1Monday);
    targetMonday.setDate(week1Monday.getDate() + (weekNumber - 1) * 7);

    // Friday of the same week
    const targetFriday = new Date(targetMonday);
    targetFriday.setDate(targetMonday.getDate() + 4);

    return { start: targetMonday, end: targetFriday };
}

// Helper to calculate Ausbildungsjahr
function calculateAusbildungsjahr(startDate: Date): number {
    const now = new Date();
    const monthsSince = (now.getFullYear() - startDate.getFullYear()) * 12 +
        (now.getMonth() - startDate.getMonth());
    if (monthsSince < 12) return 1;
    if (monthsSince < 24) return 2;
    return 3;
}

// GET /api/trainee/school/reports?traineeId=...&status=...&year=...
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const traineeId = searchParams.get('traineeId');
        const status = searchParams.get('status');
        const year = searchParams.get('year');
        const ausbildungsjahr = searchParams.get('ausbildungsjahr');

        if (!traineeId) {
            return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });
        }

        // Build conditions
        const conditions = [eq(activityReports.traineeId, traineeId as any)];

        if (status && ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(status)) {
            conditions.push(eq(activityReports.status, status as any));
        }

        if (year) {
            conditions.push(eq(activityReports.year, parseInt(year, 10)));
        }

        if (ausbildungsjahr) {
            conditions.push(eq(activityReports.ausbildungsjahr, parseInt(ausbildungsjahr, 10)));
        }

        const reports = await db
            .select()
            .from(activityReports)
            .where(and(...conditions))
            .orderBy(desc(activityReports.year), desc(activityReports.weekNumber));

        // Get current week info
        const now = new Date();
        const currentWeek = getISOWeek(now);
        const currentYear = now.getFullYear();

        // Check if current week report exists
        const hasCurrentWeekReport = reports.some(
            r => r.weekNumber === currentWeek && r.year === currentYear
        );

        // Calculate statistics
        const stats = {
            total: reports.length,
            draft: reports.filter(r => r.status === 'DRAFT').length,
            submitted: reports.filter(r => r.status === 'SUBMITTED').length,
            approved: reports.filter(r => r.status === 'APPROVED').length,
            rejected: reports.filter(r => r.status === 'REJECTED').length,
        };

        return NextResponse.json({
            reports,
            meta: {
                currentWeek,
                currentYear,
                hasCurrentWeekReport,
                stats,
            }
        });
    } catch (e) {
        console.error('List reports error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// POST /api/trainee/school/reports
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            traineeId,
            weekNumber,
            year,
            ausbildungsjahr,
            abteilung,
            // Optional: Initial entry data
            entry
        } = body;

        // Validation
        if (!traineeId) return NextResponse.json({ error: 'traineeId required' }, { status: 400 });

        // Use provided or current week/year
        const reportWeek = weekNumber || getISOWeek(new Date());
        const reportYear = year || new Date().getFullYear();

        // Check for duplicate
        const [existing] = await db
            .select({ id: activityReports.id })
            .from(activityReports)
            .where(and(
                eq(activityReports.traineeId, traineeId as any),
                eq(activityReports.weekNumber, reportWeek),
                eq(activityReports.year, reportYear)
            ));

        if (existing) {
            return NextResponse.json({
                error: 'Report for this week already exists',
                existingId: existing.id
            }, { status: 409 });
        }

        // Get trainee profile for defaults
        const [trainee] = await db
            .select({
                startOfTrainingDate: profiles.startOfTrainingDate,
                fullName: profiles.fullName
            })
            .from(profiles)
            .where(eq(profiles.id, traineeId));

        const calculatedAusbildungsjahr = ausbildungsjahr ||
            (trainee?.startOfTrainingDate ? calculateAusbildungsjahr(trainee.startOfTrainingDate) : 1);

        // Calculate week dates
        const weekDates = getWeekDates(reportWeek, reportYear);

        // Create report
        const [report] = await db
            .insert(activityReports)
            .values({
                traineeId: traineeId as any,
                ausbildungsjahr: calculatedAusbildungsjahr,
                weekNumber: reportWeek,
                year: reportYear,
                periodStart: weekDates.start,
                periodEnd: weekDates.end,
                abteilung: abteilung || 'FAE',
                status: 'DRAFT',
            })
            .returning();

        // Create initial entry if provided
        let createdEntry = null;
        if (entry && Object.keys(entry).length > 0) {
            const [entryRow] = await db
                .insert(activityReportEntries)
                .values({
                    reportId: report.id,
                    betrieblicheTaetigkeit: entry.betrieblicheTaetigkeit || null,
                    rahmenplanRef: entry.rahmenplanRef || null,
                    betrieblicheStunden: entry.betrieblicheStunden || null,
                    unterweisungenThemen: entry.unterweisungenThemen || null,
                    unterweisungenStunden: entry.unterweisungenStunden || null,
                    berufsschulThemen: entry.berufsschulThemen || null,
                    berufsschulStunden: entry.berufsschulStunden || null,
                })
                .returning();
            createdEntry = entryRow;
        }

        return NextResponse.json({
            id: report.id,
            report,
            entry: createdEntry
        }, { status: 201 });
    } catch (e) {
        console.error('Create report error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
