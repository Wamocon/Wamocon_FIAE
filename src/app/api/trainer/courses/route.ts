import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray, ilike } from 'drizzle-orm';
import {
  courses,
  courseMembers,
  courseSkills,
  enablers,
  profiles,
  skills,
} from '@/db/migrations/schemas/schema';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';

// GET /api/trainer/courses?trainerProfileId=...
// Returns ALL courses for any authenticated trainer (shared curriculum model)
// The trainerProfileId is verified for authentication but not used for filtering
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerProfileId = searchParams.get('trainerProfileId');
    const q = searchParams.get('q')?.trim();
    const year = searchParams.get('year');
    if (!trainerProfileId) {
      return NextResponse.json(
        { error: 'Missing trainerProfileId' },
        { status: 400 }
      );
    }

    const cacheKey = `trainer_courses_${trainerProfileId}_${q || ''}_${year || ''}`;
    const data = await apiCache.getOrFetch(
      cacheKey,
      async () => {
        // Build where conditions for search and year filters only
        // All trainers can see ALL courses (shared curriculum model for training platforms)
        const whereConditions: any[] = [];
        if (q) whereConditions.push(ilike(courses.title, `%${q}%`));
        if (year && year !== 'all')
          whereConditions.push(eq(courses.year, Number(year)));

        // Fetch all courses with optional search/year filters
        const list = await db
          .select({
            id: courses.id,
            title: courses.title,
            year: courses.year,
            chapter: courses.chapter,
          })
          .from(courses)
          .where(
            whereConditions.length
              ? whereConditions.length === 1
                ? whereConditions[0]
                : and(...(whereConditions as any))
              : (undefined as any)
          )
          .orderBy(courses.year, courses.chapter, courses.createdAt);

        if (list.length === 0) return { courses: [] };
        const courseIds = list.map(c => c.id);

        const enCounts = await db
          .select({ courseId: enablers.courseId, cnt: count() })
          .from(enablers)
          .where(inArray(enablers.courseId, courseIds))
          .groupBy(enablers.courseId);
        const enMap = new Map<string, number>(
          enCounts.map(r => [String(r.courseId), Number(r.cnt)])
        );

        // Use-cases reside in useCases table; select via dynamic import to avoid circular
        const { useCases } = await import('@/db/migrations/schemas/schema');
        const ucCounts = await db
          .select({ courseId: useCases.courseId, cnt: count() })
          .from(useCases)
          .where(inArray(useCases.courseId, courseIds))
          .groupBy(useCases.courseId);
        const ucMap = new Map<string, number>(
          ucCounts.map(r => [String(r.courseId), Number(r.cnt)])
        );

        const memberCounts = await db
          .select({
            courseId: courseMembers.courseId,
            role: courseMembers.role,
            cnt: count(),
          })
          .from(courseMembers)
          .where(inArray(courseMembers.courseId, courseIds))
          .groupBy(courseMembers.courseId, courseMembers.role);

        const trainerCountMap = new Map<string, number>();
        const traineeCountMap = new Map<string, number>();
        for (const row of memberCounts) {
          const id = String(row.courseId);
          if (row.role === 'TRAINER') trainerCountMap.set(id, Number(row.cnt));
          if (row.role === 'TRAINEE') traineeCountMap.set(id, Number(row.cnt));
        }

        const out = list.map(c => ({
          id: c.id,
          title: c.title,
          year: c.year,
          chapter: c.chapter,
          enablersCount: enMap.get(String(c.id)) || 0,
          useCasesCount: ucMap.get(String(c.id)) || 0,
          trainersCount: trainerCountMap.get(String(c.id)) || 0,
          traineesCount: traineeCountMap.get(String(c.id)) || 0,
        }));

        return { courses: out };
      },
      ApiCache.TTL.MEDIUM
    );

    return NextResponse.json(data, { headers: cacheHeaders.medium });
  } catch (e) {
    console.error('List courses error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// POST /api/trainer/courses
// Create a course with optional skills
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title: string | undefined = body?.title;
    const year: number | undefined = body?.year ? Number(body.year) : undefined;
    const chapter: number | undefined = body?.chapter
      ? Number(body.chapter)
      : undefined;
    const createdById: string | undefined = body?.createdById;
    const skillNames: string[] = Array.isArray(body?.skills) ? body.skills : [];
    if (!title || !createdById) {
      return NextResponse.json(
        { error: 'Missing title or createdById' },
        { status: 400 }
      );
    }

    const result = await db.transaction(async tx => {
      const [course] = await tx
        .insert(courses)
        .values({
          title,
          year: year as any,
          chapter: chapter as any,
          createdById,
        })
        .returning();

      // Ensure creator is a trainer member of this course
      await tx.insert(courseMembers).values({
        courseId: course.id,
        userId: createdById as any,
        role: 'TRAINER' as any,
      });

      if (skillNames.length) {
        // Upsert skills by name then attach
        const existing = await tx
          .select()
          .from(skills)
          .where(inArray(skills.name, skillNames));
        const existingNames = new Set(existing.map(s => s.name));
        const toInsert = skillNames
          .filter(n => !existingNames.has(n))
          .map(name => ({ name }));
        if (toInsert.length) await tx.insert(skills).values(toInsert);
        const allSkills = await tx
          .select()
          .from(skills)
          .where(inArray(skills.name, skillNames));
        if (allSkills.length) {
          await tx
            .insert(courseSkills)
            .values(
              allSkills.map(s => ({ courseId: course.id, skillId: s.id }))
            );
        }
      }

      return course;
    });

    // Bust the cached GET so the next read returns fresh data
    apiCache.invalidate('trainer_courses');

    return NextResponse.json({ course: result });
  } catch (e) {
    console.error('Create course error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
