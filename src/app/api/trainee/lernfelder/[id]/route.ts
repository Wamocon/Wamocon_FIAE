import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  trainingCatalogLearningFields as learningFields,
  useCases,
} from '@/db/migrations/schemas/schema';
import { eq, and, arrayContains } from 'drizzle-orm';
import { allowedCatalogCondition } from '@/lib/catalog/scope';
import { requireOptionalSessionScope } from '@/lib/catalog/public';
import { legacyLearningFieldSelect } from '@/lib/catalog/learning-fields';

/**
 * GET /api/trainee/lernfelder/[id]
 * Get details for Trainee (only inside the caller's catalog).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireOptionalSessionScope(_req);
    if (scope instanceof Response) return scope;

    const { id } = await params;
    const [row] = await db
      .select(legacyLearningFieldSelect)
      .from(learningFields)
      .where(
        and(
          eq(learningFields.id, id),
          allowedCatalogCondition(learningFields.trainingCatalogId, scope)
        )
      );
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Trainees see active Use Cases of the same catalog matching this lernfeld
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
          arrayContains(useCases.lernfelder, [row.label]),
          eq(useCases.trainingCatalogId, row.trainingCatalogId)
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
