
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { lernfelderSchema, useCases } from '@/db/migrations/schemas/schema';
import { eq, arrayContains } from 'drizzle-orm';

/**
 * GET /api/trainer/lernfelder
 * List all Lernfelder with a count of related use cases.
 */
export async function GET() {
    try {
        const list = await db.select().from(lernfelderSchema).orderBy(lernfelderSchema.createdAt);

        // For each lernfeld, count use cases that match the label
        // Use Cases have "lernfelder" as text[] (array of strings 'LF-1', 'LF-5', etc.)
        // We want to count use cases where user_cases.lernfelder contains l.label

        // Efficient approach: fetch all use cases with lernfelder defined, then aggregate in memory 
        // (assuming not huge dataset) or do a correlated subquery if supported. 
        // Given the potentially complex filtering, fetching all use cases with lernfelder is safer/easier to reason for now.
        // Or we can do individual counts if use cases are many. Let's start with a simpler in-mem aggregation for now as use cases < 1000 usually.

        // Actually, SQL is better:
        // select count(*) from use_cases where label = ANY(lernfelder)
        // But Drizzle with raw SQL or helper

        const allUseCases = await db
            .select({ id: useCases.id, lernfelder: useCases.lernfelder })
            .from(useCases);

        const result = list.map((l) => {
            // label is 'LF-1'
            // useCase.lernfelder is ['LF-1', 'LF-2']
            // count if l.label is in useCase.lernfelder
            const count = allUseCases.filter(u => u.lernfelder && Array.isArray(u.lernfelder) && u.lernfelder.includes(l.label)).length;
            return { ...l, useCaseCount: count };
        });

        return NextResponse.json({ lernfelder: result });
    } catch (e) {
        console.error('List lernfelder error', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * POST /api/trainer/lernfelder
 * Create a new Lernfeld.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { title, description, label } = body;

        if (!title || !label) {
            return NextResponse.json({ error: 'Missing title or label' }, { status: 400 });
        }

        const [inserted] = await db.insert(lernfelderSchema).values({
            title,
            description,
            label
        }).returning();

        return NextResponse.json({ lernfelder: inserted });
    } catch (e) {
        console.error('Create lernfelder error', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
