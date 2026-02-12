import { NextResponse } from 'next/server';
import db from '@/db';
import { mesSoftskillCriteria } from '@/db/migrations/schemas/schema';
import { asc } from 'drizzle-orm';

// GET: Fetch all soft skill criteria
export async function GET() {
    try {
        const criteria = await db
            .select()
            .from(mesSoftskillCriteria)
            .orderBy(asc(mesSoftskillCriteria.orderIndex));

        return NextResponse.json({ criteria });
    } catch (error: any) {
        // If table doesn't exist yet, return empty array
        if (error?.cause?.code === '42P01') {
            console.warn('Table mes_softskill_criteria does not exist yet - returning empty array');
            return NextResponse.json({ criteria: [] });
        }
        console.error('Error fetching softskill criteria:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
