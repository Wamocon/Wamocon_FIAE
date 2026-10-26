import {
  requireTrainer,
  requireCurriculumEditor,
  isErrorResponse,
} from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  trainingCatalogLearningFields as learningFields,
  useCases,
} from '@/db/migrations/schemas/schema';
import { and, eq, arrayContains } from 'drizzle-orm';
import {
  allowedCatalogCondition,
  requireCatalogScope,
} from '@/lib/catalog/scope';
import {
  LEARNING_FIELD_LABEL_CONFLICT,
  isLearningFieldLabelConflict,
  labelTrainingYear,
  legacyLearningFieldSelect,
} from '@/lib/catalog/learning-fields';

/**
 * GET /api/trainer/lernfelder/[id]
 * Get details of a specific Lernfeld (only inside the caller's catalogs).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireTrainer(_req);
    if (isErrorResponse(session)) return session;

    const scope = await requireCatalogScope(session, _req);
    if (isErrorResponse(scope)) return scope;

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
          arrayContains(useCases.lernfelder, [row.label]),
          eq(useCases.trainingCatalogId, row.trainingCatalogId)
        )
      );

    return NextResponse.json({
      lernfeld: row,
      useCases: relatedUseCases,
    });
  } catch (e) {
    console.error('Get lernfeld detail error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/trainer/lernfelder/[id]
 * Update a Lernfeld (only inside the caller's catalogs).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;

    const { id } = await params;
    const trainerId = session.id;
    const scope = await requireCatalogScope(session, req);
    if (isErrorResponse(scope)) return scope;

    const body = await req.json();
    const { title, description, label } = body; // All optional

    const [updated] = await db
      .update(learningFields)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        // a new label (for example LF-3 to LF-8) moves the learning field to
        // the training year of its new number
        ...(label !== undefined
          ? { code: label, trainingYear: labelTrainingYear(String(label)) }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(learningFields.id, id),
          allowedCatalogCondition(learningFields.trainingCatalogId, scope)
        )
      )
      .returning(legacyLearningFieldSelect);

    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ lernfeld: updated });
  } catch (e) {
    if (isLearningFieldLabelConflict(e)) {
      return NextResponse.json(
        { error: LEARNING_FIELD_LABEL_CONFLICT },
        { status: 409 }
      );
    }
    console.error('Update lernfeld error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trainer/lernfelder/[id]
 * Delete a Lernfeld (only inside the caller's catalogs).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;

    const { id } = await params;
    const trainerId = session.id;
    const scope = await requireCatalogScope(session, req);
    if (isErrorResponse(scope)) return scope;

    await db
      .delete(learningFields)
      .where(
        and(
          eq(learningFields.id, id),
          allowedCatalogCondition(learningFields.trainingCatalogId, scope)
        )
      );
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Delete lernfeld error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
