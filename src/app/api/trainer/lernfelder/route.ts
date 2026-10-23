import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  trainingCatalogLearningFields as learningFields,
  useCases,
} from '@/db/migrations/schemas/schema';
import { arrayContains, count, and, eq } from 'drizzle-orm';
import { verifyPlatformOwner } from '@/lib/auth-helpers';
import { catalogCondition, requireCatalogScope } from '@/lib/catalog/scope';
import {
  labelTrainingYear,
  legacyLearningFieldSelect,
  nextLearningFieldOrderIndex,
} from '@/lib/catalog/learning-fields';

/**
 * GET /api/trainer/lernfelder
 * List the Lernfelder of the caller's catalogs with a count of related use
 * cases (of the same catalog).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const scope = await requireCatalogScope(session, req);
    if (isErrorResponse(scope)) return scope;

    const list = await db
      .select(legacyLearningFieldSelect)
      .from(learningFields)
      .where(catalogCondition(learningFields.trainingCatalogId, scope))
      .orderBy(learningFields.createdAt);

    // Batch: get use case counts per lernfeld label using SQL arrayContains
    const countResults = await Promise.all(
      list.map(l =>
        db
          .select({ c: count() })
          .from(useCases)
          .where(
            and(
              arrayContains(useCases.lernfelder, [l.label]),
              eq(useCases.trainingCatalogId, l.trainingCatalogId)
            )
          )
          .then(rows => ({
            key: `${l.trainingCatalogId}:${l.label}`,
            count: Number(rows[0]?.c ?? 0),
          }))
      )
    );
    const countMap = new Map(countResults.map(r => [r.key, r.count]));

    const result = list.map(l => ({
      ...l,
      useCaseCount: countMap.get(`${l.trainingCatalogId}:${l.label}`) || 0,
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
 * Create a new Lernfeld in the active catalog.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const trainerId = session.id;
    if (!(await verifyPlatformOwner(trainerId))) {
      return NextResponse.json(
        { error: 'Only platform administrators can manage curriculum content' },
        { status: 403 }
      );
    }

    const scope = await requireCatalogScope(session, req);
    if (isErrorResponse(scope)) return scope;

    const body = await req.json();
    const { title, description, label } = body;

    if (!title || !label) {
      return NextResponse.json(
        { error: 'Missing title or label' },
        { status: 400 }
      );
    }

    const [inserted] = await db
      .insert(learningFields)
      .values({
        trainingCatalogId: scope.activeCatalogId,
        code: label,
        title,
        description,
        trainingYear: labelTrainingYear(String(label)),
        orderIndex: await nextLearningFieldOrderIndex(scope.activeCatalogId),
      })
      .returning(legacyLearningFieldSelect);

    return NextResponse.json({ lernfelder: inserted });
  } catch (e) {
    console.error('Create lernfelder error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
