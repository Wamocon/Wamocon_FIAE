import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import db from '@/db';
import { mesSoftskillCriteria } from '@/db/migrations/schemas/schema';
import { asc } from 'drizzle-orm';

// GET: Fetch all soft skill criteria. The criteria are master data without
// personal data, but only the signed-in pages read them, so any signed-in,
// active account may read them (no role needed) and an anonymous call is
// answered with 401.
export async function GET(req: NextRequest) {
    try {
        const session = await requireUser(req);
        if (isErrorResponse(session)) return session;

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
