import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { lernfelderSchema, useCases } from '@/db/migrations/schemas/schema';
import { eq, arrayContains, count, and } from 'drizzle-orm';

/**
 * GET /api/trainer/lernfelder
 * List all Lernfelder with a count of related use cases.
 */
export async function GET() {
  try {
    const list = await db
      .select()
      .from(lernfelderSchema)
      .orderBy(lernfelderSchema.createdAt);

    // Batch: get use case counts per lernfeld label using SQL arrayContains
    const countResults = await Promise.all(
      list.map(l =>
        db
          .select({ c: count() })
          .from(useCases)
          .where(arrayContains(useCases.lernfelder, [l.label]))
          .then(rows => ({ label: l.label, count: Number(rows[0]?.c ?? 0) }))
      )
    );
    const countMap = new Map(countResults.map(r => [r.label, r.count]));

    const result = list.map(l => ({
      ...l,
      useCaseCount: countMap.get(l.label) || 0,
    }));

    return NextResponse.json({ lernfelder: result });
  } catch (e) {
    console.error('List lernfelder error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
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
      return NextResponse.json(
        { error: 'Missing title or label' },
        { status: 400 }
      );
    }

    const [inserted] = await db
      .insert(lernfelderSchema)
      .values({
        title,
        description,
        label,
      })
      .returning();

    return NextResponse.json({ lernfelder: inserted });
  } catch (e) {
    console.error('Create lernfelder error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
