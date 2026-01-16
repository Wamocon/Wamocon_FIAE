/**
 * Lernfelder API - Master data for FIAE learning fields
 * 
 * GET /api/trainee/school/lernfelder - List all Lernfelder
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { asc, eq } from 'drizzle-orm';
import { lernfelder } from '@/db/migrations/schemas/schema';

// GET /api/trainee/school/lernfelder?year=...&common=...
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const year = searchParams.get('year');
        const common = searchParams.get('common');

        let query = db
            .select()
            .from(lernfelder)
            .orderBy(asc(lernfelder.orderIndex));

        const rows = await query;

        // Filter in memory for simplicity (small dataset)
        let filtered = rows;

        if (year) {
            const yearNum = parseInt(year, 10);
            filtered = filtered.filter(lf => lf.trainingYear === yearNum);
        }

        if (common === 'true') {
            filtered = filtered.filter(lf => lf.isCommon === true);
        } else if (common === 'false') {
            filtered = filtered.filter(lf => lf.isCommon === false);
        }

        // Group by training year for UI convenience
        const byYear: Record<number, typeof filtered> = {};
        filtered.forEach(lf => {
            const y = lf.trainingYear || 0;
            if (!byYear[y]) byYear[y] = [];
            byYear[y].push(lf);
        });

        // Calculate stats
        const totalHours = filtered.reduce((acc, lf) => acc + (lf.hoursBudget || 0), 0);
        const commonCount = filtered.filter(lf => lf.isCommon).length;
        const fiaeCount = filtered.filter(lf => !lf.isCommon).length;

        return NextResponse.json({
            lernfelder: filtered,
            byYear,
            meta: {
                total: filtered.length,
                totalHours,
                commonCount,
                fiaeSpecificCount: fiaeCount,
            }
        });
    } catch (e) {
        console.error('List lernfelder error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
