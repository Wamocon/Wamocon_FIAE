import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  courseMembers,
  courses,
  enablers,
  trainingCatalogContentMappings as mappings,
  trainingCatalogLearningFields as learningFields,
  useCases,
} from '@/db/migrations/schemas/schema';
import { eq, and, arrayContains } from 'drizzle-orm';
import { allowedCatalogCondition } from '@/lib/catalog/scope';
import { requireOptionalSessionScope } from '@/lib/catalog/public';
import { legacyLearningFieldSelect } from '@/lib/catalog/learning-fields';
import { getSessionUser } from '@/lib/auth/session';
import { notFoundUnlessUuid } from '@/lib/uuid';

/**
 * GET /api/trainee/lernfelder/[id]
 * Get details for Trainee (only inside the caller's catalog).
 *
 * The answer has the learning field (with its hours and school year), the
 * active use cases that name it and, for a signed-in caller, the active
 * enablers that are mapped to it. `accessible` tells whether the caller is a
 * member of the course of the item, so the page links only what opens. Nothing
 * of the solutions is in the answer: it carries titles, descriptions and times,
 * the documents of an enabler or a use case have their own routes with their
 * own checks.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireOptionalSessionScope(_req);
    if (scope instanceof Response) return scope;

    const { id } = await params;
    const idNotFound = notFoundUnlessUuid(id);
    if (idNotFound) return idNotFound;
    const [row] = await db
      .select({
        ...legacyLearningFieldSelect,
        hoursBudget: learningFields.hoursBudget,
        trainingYear: learningFields.trainingYear,
      })
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

    // Courses the caller is a member of (none without a session)
    const session = await getSessionUser(_req);
    const memberCourseIds = new Set<string>();
    if (session) {
      const memberships = await db
        .select({ courseId: courseMembers.courseId })
        .from(courseMembers)
        .where(eq(courseMembers.userId, session.id));
      for (const m of memberships) memberCourseIds.add(String(m.courseId));
    }
    const accessible = (courseId: string | null) =>
      courseId !== null && memberCourseIds.has(String(courseId));

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

    // Active enablers mapped to the learning field (signed-in callers only)
    const mappedEnablers = session
      ? await db
          .select({
            id: enablers.id,
            code: enablers.code,
            title: enablers.title,
            courseId: enablers.courseId,
            courseTitle: courses.title,
            orderIndex: enablers.orderIndex,
            durationValue: enablers.durationValue,
            durationUnit: enablers.durationUnit,
          })
          .from(mappings)
          .innerJoin(enablers, eq(enablers.id, mappings.enablerId))
          .innerJoin(courses, eq(courses.id, enablers.courseId))
          .where(
            and(
              eq(mappings.learningFieldId, row.id),
              eq(enablers.isActive, true),
              eq(enablers.trainingCatalogId, row.trainingCatalogId)
            )
          )
          .orderBy(courses.title, enablers.orderIndex)
      : [];
    const seen = new Set<string>();
    const uniqueEnablers = mappedEnablers.filter(e => {
      const key = String(e.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({
      lernfeld: row,
      useCases: relatedUseCases.map(u => ({
        ...u,
        accessible: accessible(u.courseId ? String(u.courseId) : null),
      })),
      enablers: uniqueEnablers.map(e => ({
        ...e,
        accessible: accessible(String(e.courseId)),
      })),
    });
  } catch (e) {
    console.error('Trainee get lernfeld detail error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
