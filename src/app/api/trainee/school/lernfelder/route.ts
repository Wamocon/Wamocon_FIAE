/**
 * Lernfelder API - Master data for FIAE learning fields
 * 
 * GET /api/trainee/school/lernfelder - List all Lernfelder
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { asc } from 'drizzle-orm';
import { lernfelderSchema } from '@/db/migrations/schemas/schema';

// GET /api/trainee/school/lernfelder
export async function GET(req: NextRequest) {
    try {
        const rows = await db
            .select()
            .from(lernfelderSchema)
            .orderBy(asc(lernfelderSchema.label));

        // Map DB fields to the format expected by the frontend
        const lernfelder = rows.map((lf, index) => ({
            id: lf.id,
            code: lf.label,
            name: lf.title,
            title: lf.title,
            description: lf.description,
            trainingYear: null,
            hoursBudget: null,
            isCommon: false,
            orderIndex: index,
            createdAt: lf.createdAt,
        }));

        return NextResponse.json({
            lernfelder,
            meta: {
                total: lernfelder.length,
            }
        });
    } catch (e) {
        console.error('List lernfelder error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
