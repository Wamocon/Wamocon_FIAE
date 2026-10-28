import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  courses,
  courseMembers,
  useCases,
  useCaseSubmissions,
} from '@/db/migrations/schemas/schema';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';
import {
  catalogCacheKey,
  catalogCondition,
  requireCatalogScopeForUser,
} from '@/lib/catalog/scope';
import { loadCourseProgressions } from '@/lib/catalog/progression-db';

// GET courses for a trainee with progress calculation
// An enabler is complete when every active lesson quiz is passed (score >= 50%).
// The definition lives in src/lib/catalog/progression.ts, the scenario of an
// enabler does not count.
// Courses that are not active are not listed (the page "Lernen" shows only
// what is released).
// The data of the session user, a traineeId or userId in the query is ignored.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const traineeId = session.id;

  try {
    const scope = await requireCatalogScopeForUser(traineeId, req);
    if (scope instanceof Response) return scope;

    const data = await apiCache.getOrFetch(
      `trainee_courses_${traineeId}_${catalogCacheKey(scope)}`,
      async () => {
        const memberships = await db
          .select()
          .from(courseMembers)
          .where(eq(courseMembers.userId, traineeId));
        const memberCourseIds: string[] = memberships.map(m => m.courseId);
        // Only courses of the trainee's catalog scope
        const courseIds: string[] = memberCourseIds.length
          ? (
              await db
                .select({ id: courses.id })
                .from(courses)
                .where(
                  and(
                    inArray(courses.id, memberCourseIds),
                    eq(courses.isActive, true),
                    catalogCondition(courses.trainingCatalogId, scope)
                  )
                )
            ).map(r => String(r.id))
          : [];
        if (!courseIds.length) return { courses: [] };

        const rows = await db
          .select()
          .from(courses)
          .where(inArray(courses.id, courseIds));
        // The completion of every enabler, by the one definition
        const progressions = await loadCourseProgressions(traineeId, courseIds);
        const anyEnabler = Array.from(progressions.values()).some(
          p => p.progression.totalCount > 0
        );
        if (!anyEnabler) {
          return {
            courses: rows.map(c => ({
              id: c.id,
              title: c.title,
              year: c.year,
              chapter: c.chapter,
              progress: 0,
              enablerCount: 0,
              completedCount: 0,
            })),
          };
        }

        // Get use cases for these courses - need ALL to be approved for course completion
        const useCaseRows = await db
          .select({ id: useCases.id, courseId: useCases.courseId })
          .from(useCases)
          .where(
            and(
              inArray(useCases.courseId, courseIds as any),
              eq(useCases.isActive, true)
            )
          );

        // Get use case submissions - APPROVED ones
        const useCaseIds = useCaseRows.map(u => u.id);
        const useCaseSubRows =
          useCaseIds.length > 0
            ? await db
                .select({ useCaseId: useCaseSubmissions.useCaseId })
                .from(useCaseSubmissions)
                .where(
                  and(
                    eq(useCaseSubmissions.traineeId, traineeId as any),
                    inArray(useCaseSubmissions.useCaseId, useCaseIds as any),
                    eq(useCaseSubmissions.status, 'APPROVED')
                  )
                )
            : [];
        const approvedUseCases = new Set(
          useCaseSubRows.map(r => String(r.useCaseId))
        );

        // Calculate progress per course
        const result = rows.map(c => {
          const own = progressions.get(String(c.id))?.progression;
          const totalEnablers = own?.totalCount ?? 0;
          const completedCount = own?.completedCount ?? 0;

          // Get use cases for this course
          const courseUseCases = useCaseRows.filter(
            u => String(u.courseId) === String(c.id)
          );
          const totalUseCases = courseUseCases.length;
          const approvedUseCaseCount = courseUseCases.filter(u =>
            approvedUseCases.has(String(u.id))
          ).length;

          if (totalEnablers === 0 && totalUseCases === 0) {
            return {
              id: c.id,
              title: c.title,
              year: c.year,
              chapter: c.chapter,
              progress: 0,
              enablerCount: 0,
              completedCount: 0,
            };
          }

          // Calculate weighted progress:
          // - Enablers: 70% weight
          // - Use Cases: 30% weight (if any)
          const enablerProgress =
            totalEnablers > 0 ? completedCount / totalEnablers : 1;
          const useCaseProgress =
            totalUseCases > 0 ? approvedUseCaseCount / totalUseCases : 1;

          let progress: number;
          if (totalEnablers > 0 && totalUseCases > 0) {
            progress = Math.round(
              (enablerProgress * 0.7 + useCaseProgress * 0.3) * 100
            );
          } else if (totalEnablers > 0) {
            progress = Math.round(enablerProgress * 100);
          } else {
            progress = Math.round(useCaseProgress * 100);
          }

          return {
            id: c.id,
            title: c.title,
            year: c.year,
            chapter: c.chapter,
            progress,
            enablerCount: totalEnablers,
            completedCount,
          };
        });

        return { courses: result };
      },
      ApiCache.TTL.MEDIUM
    );

    return NextResponse.json(data, { headers: cacheHeaders.medium });
  } catch (e) {
    console.error('Trainee courses GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
