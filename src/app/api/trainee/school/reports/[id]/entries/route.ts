/**
 * Activity Report Entries API
 * 
 * GET  /api/trainee/school/reports/[id]/entries - List entries for report
 * POST /api/trainee/school/reports/[id]/entries - Add entry to report
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { activityReports, activityReportEntries } from '@/db/migrations/schemas/schema';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// GET /api/trainee/school/reports/[id]/entries
export async function GET(req: NextRequest, { params }: RouteParams) {
    try {
        const { id: reportId } = await params;

        // Verify report exists
        const [report] = await db
            .select({ id: activityReports.id })
            .from(activityReports)
            .where(eq(activityReports.id, reportId as any));

        if (!report) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        const entries = await db
            .select()
            .from(activityReportEntries)
            .where(eq(activityReportEntries.reportId, reportId as any));

        // Calculate totals
        const totals = entries.reduce(
            (acc, entry) => ({
                betrieblicheStunden: acc.betrieblicheStunden + (entry.betrieblicheStunden || 0),
                unterweisungenStunden: acc.unterweisungenStunden + (entry.unterweisungenStunden || 0),
                berufsschulStunden: acc.berufsschulStunden + (entry.berufsschulStunden || 0),
            }),
            { betrieblicheStunden: 0, unterweisungenStunden: 0, berufsschulStunden: 0 }
        );

        return NextResponse.json({
            entries,
            totals,
            totalHours: totals.betrieblicheStunden + totals.unterweisungenStunden + totals.berufsschulStunden,
        });
    } catch (e) {
        console.error('List entries error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// POST /api/trainee/school/reports/[id]/entries
export async function POST(req: NextRequest, { params }: RouteParams) {
    try {
        const { id: reportId } = await params;
        const body = await req.json();

        // Verify report exists and is editable
        const [report] = await db
            .select({ id: activityReports.id, status: activityReports.status })
            .from(activityReports)
            .where(eq(activityReports.id, reportId as any));

        if (!report) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        if (report.status !== 'DRAFT' && report.status !== 'REJECTED') {
            return NextResponse.json({
                error: 'Cannot add entries to submitted or approved reports'
            }, { status: 403 });
        }

        // Validate at least one field is provided
        const {
            betrieblicheTaetigkeit,
            rahmenplanRef,
            betrieblicheStunden,
            unterweisungenThemen,
            unterweisungenStunden,
            berufsschulThemen,
            berufsschulStunden,
        } = body;

        const hasContent = betrieblicheTaetigkeit || unterweisungenThemen || berufsschulThemen;
        if (!hasContent) {
            return NextResponse.json({
                error: 'At least one content field (betrieblicheTaetigkeit, unterweisungenThemen, or berufsschulThemen) is required'
            }, { status: 400 });
        }

        const [entry] = await db
            .insert(activityReportEntries)
            .values({
                reportId: reportId as any,
                betrieblicheTaetigkeit: betrieblicheTaetigkeit || null,
                rahmenplanRef: rahmenplanRef || null,
                betrieblicheStunden: betrieblicheStunden ?? null,
                unterweisungenThemen: unterweisungenThemen || null,
                unterweisungenStunden: unterweisungenStunden ?? null,
                berufsschulThemen: berufsschulThemen || null,
                berufsschulStunden: berufsschulStunden ?? null,
            })
            .returning();

        return NextResponse.json({ entry }, { status: 201 });
    } catch (e) {
        console.error('Create entry error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PUT /api/trainee/school/reports/[id]/entries (batch update)
export async function PUT(req: NextRequest, { params }: RouteParams) {
    try {
        const { id: reportId } = await params;
        const body = await req.json();
        const { entries } = body;

        if (!Array.isArray(entries)) {
            return NextResponse.json({ error: 'entries array required' }, { status: 400 });
        }

        // Verify report exists and is editable
        const [report] = await db
            .select({ id: activityReports.id, status: activityReports.status })
            .from(activityReports)
            .where(eq(activityReports.id, reportId as any));

        if (!report) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        if (report.status !== 'DRAFT' && report.status !== 'REJECTED') {
            return NextResponse.json({
                error: 'Cannot edit entries of submitted or approved reports'
            }, { status: 403 });
        }

        const updatedEntries = [];

        for (const entryData of entries) {
            if (!entryData.id) continue;

            const updateData: Record<string, any> = {};
            if (entryData.betrieblicheTaetigkeit !== undefined)
                updateData.betrieblicheTaetigkeit = entryData.betrieblicheTaetigkeit;
            if (entryData.rahmenplanRef !== undefined)
                updateData.rahmenplanRef = entryData.rahmenplanRef;
            if (entryData.betrieblicheStunden !== undefined)
                updateData.betrieblicheStunden = entryData.betrieblicheStunden;
            if (entryData.unterweisungenThemen !== undefined)
                updateData.unterweisungenThemen = entryData.unterweisungenThemen;
            if (entryData.unterweisungenStunden !== undefined)
                updateData.unterweisungenStunden = entryData.unterweisungenStunden;
            if (entryData.berufsschulThemen !== undefined)
                updateData.berufsschulThemen = entryData.berufsschulThemen;
            if (entryData.berufsschulStunden !== undefined)
                updateData.berufsschulStunden = entryData.berufsschulStunden;

            if (Object.keys(updateData).length > 0) {
                const [updated] = await db
                    .update(activityReportEntries)
                    .set(updateData)
                    .where(eq(activityReportEntries.id, entryData.id))
                    .returning();
                updatedEntries.push(updated);
            }
        }

        return NextResponse.json({ entries: updatedEntries });
    } catch (e) {
        console.error('Update entries error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
