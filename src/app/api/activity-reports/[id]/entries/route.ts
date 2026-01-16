import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { activityReportUseCaseEntries } from '@/db/migrations/schemas/schema';

// GET: Get report entries for a specific report
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const entries = await db
            .select()
            .from(activityReportUseCaseEntries)
            .where(eq(activityReportUseCaseEntries.reportId, id as any))
            .orderBy(activityReportUseCaseEntries.createdAt);

        const formattedEntries = entries.map(e => ({
            id: e.id,
            reportId: e.reportId,
            useCaseId: e.useCaseId,
            plannedHours: e.plannedHours,
            actualHours: e.actualHours,
            isOverbooked: e.isOverbooked,
            notes: e.notes,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
        }));

        return NextResponse.json({ entries: formattedEntries });
    } catch (error: any) {
        // If table doesn't exist yet, return empty entries
        if (error?.cause?.code === '42P01') {
            console.warn('Table activity_report_use_case_entries does not exist yet - returning empty entries');
            return NextResponse.json({ entries: [] });
        }
        console.error('Error in report entries GET:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
