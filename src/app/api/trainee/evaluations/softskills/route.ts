import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { mesSoftskillCriteria } from '@/db/migrations/schemas/schema';
import { asc } from 'drizzle-orm';

// GET: Fetch all 19 MES softskill criteria
export async function GET() {
    try {
        const criteria = await db
            .select()
            .from(mesSoftskillCriteria)
            .orderBy(asc(mesSoftskillCriteria.orderIndex));

        // Group by competency area for UI convenience
        const groupedByArea = criteria.reduce((acc, criterion) => {
            const area = criterion.competencyArea;
            if (!acc[area]) {
                acc[area] = [];
            }
            acc[area].push(criterion);
            return acc;
        }, {} as Record<string, typeof criteria>);

        return NextResponse.json({
            criteria,
            groupedByArea,
            totalCount: criteria.length
        });
    } catch (error) {
        console.error('Error fetching MES criteria:', error);
        return NextResponse.json(
            { error: 'Failed to fetch softskill criteria' },
            { status: 500 }
        );
    }
}
