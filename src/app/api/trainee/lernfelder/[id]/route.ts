import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { lernfelderSchema, useCases } from '@/db/migrations/schemas/schema';
import { eq, and, arrayContains } from 'drizzle-orm';

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
    const [row] = await db
      .select()
      .from(lernfelderSchema)
      .where(eq(lernfelderSchema.id, id));
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Trainees see active Use Cases matching this lernfeld
    const relatedUseCases = await db
      .select({
        id: useCases.id,
        title: useCases.title,
        courseId: useCases.courseId,
        descriptionText: useCases.descriptionText,
        orderIndex: useCases.orderIndex,
        durationValue: useCases.durationValue,
        durationUnit: useCases.durationUnit,
        isActive: useCases.isActive,
        year: useCases.year,
        trainingStage: useCases.trainingStage,
        lernfelder: useCases.lernfelder,
      })
      .from(useCases)
      .where(
        and(
          eq(useCases.isActive, true),
          arrayContains(useCases.lernfelder, [row.label])
        )
      );

    return NextResponse.json({
      lernfeld: row,
      useCases: relatedUseCases,
    });
  } catch (e) {
    console.error('Trainee get lernfeld detail error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
