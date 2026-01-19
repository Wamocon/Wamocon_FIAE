
import { NextResponse } from 'next/server';
import db from '@/db';
import { lernfelderSchema, useCases } from '@/db/migrations/schemas/schema';

/**
 * GET /api/trainee/lernfelder
 * Read-only list for trainees.
 */
export async function GET() {
    try {
        const list = await db.select().from(lernfelderSchema).orderBy(lernfelderSchema.createdAt);

        // Count logic same as trainer
        const allUseCases = await db.select({ id: useCases.id, lernfelder: useCases.lernfelder, isActive: useCases.isActive }).from(useCases);

        // Only count ACTIVE use cases for trainees? The user didn't specify, but usually trainee sees what's active.
        // "UI must be same as Kurse" -> Kurs cards show progress or item counts. 
        // Requirement: "box we will only have usecase and number of usecases"

        const result = list.map((l) => {
            // Filter for active ones potentially? Or all? User said "number of usecases under the learnfeld".
            // Let's count all (or maybe filter isActive=true if strict trainee view).
            // Given "same box as inhaltmanager", that's Trainer view. Trainee view usually differs.
            // But user said "UI must be same as Kurse" (Trainee Courses page).
            // Let's count *visible* use cases.
            const relevant = allUseCases.filter(u =>
                u.isActive &&
                u.lernfelder &&
                Array.isArray(u.lernfelder) &&
                u.lernfelder.includes(l.label)
            );
            return { ...l, useCaseCount: relevant.length };
        });

        return NextResponse.json({ lernfelder: result });
    } catch (e) {
        console.error('Trainee list lernfelder error', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
