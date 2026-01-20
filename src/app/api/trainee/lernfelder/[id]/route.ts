
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { lernfelderSchema, useCases } from '@/db/migrations/schemas/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/trainee/lernfelder/[id]
 * Get details for Trainee.
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const [row] = await db.select().from(lernfelderSchema).where(eq(lernfelderSchema.id, id));
        if (!row) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const allUseCases = await db.select().from(useCases);
        // Trainees see active Use Cases
        const relatedUseCases = allUseCases.filter(u =>
            u.isActive &&
            u.lernfelder &&
            Array.isArray(u.lernfelder) &&
            u.lernfelder.includes(row.label)
        );

        return NextResponse.json({
            lernfeld: row,
            useCases: relatedUseCases
        });
    } catch (e) {
        console.error('Trainee get lernfeld detail error', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
