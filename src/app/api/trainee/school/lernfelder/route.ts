/**
 * Lernfelder API - Master data for LFA learning fields
 *
 * GET /api/trainee/school/lernfelder - List the Lernfelder of the caller's
 * catalog (session scope, or the active public catalog without a session).
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { asc } from 'drizzle-orm';
import { trainingCatalogLearningFields as learningFields } from '@/db/migrations/schemas/schema';
import { catalogCondition } from '@/lib/catalog/scope';
import { requireOptionalSessionScope } from '@/lib/catalog/public';
import { legacyLearningFieldSelect } from '@/lib/catalog/learning-fields';

// GET /api/trainee/school/lernfelder
export async function GET(req: NextRequest) {
  try {
    const scope = await requireOptionalSessionScope(req);
    if (scope instanceof Response) return scope;

    const rows = await db
      .select(legacyLearningFieldSelect)
      .from(learningFields)
      .where(catalogCondition(learningFields.trainingCatalogId, scope))
      .orderBy(asc(learningFields.code));

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
      },
    });
  } catch (e) {
    console.error('List lernfelder error:', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
