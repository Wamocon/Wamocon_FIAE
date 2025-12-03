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

// GET /api/trainer/courses?trainerProfileId=...
// Returns courses created by this trainer with counts of enablers and use-cases
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerProfileId = searchParams.get('trainerProfileId');
    const q = searchParams.get('q')?.trim();
    const year = searchParams.get('year');
    if (!trainerProfileId) {
      return NextResponse.json({ error: 'Missing trainerProfileId' }, { status: 400 });
    }

    // Courses created by this trainer OR where trainer is a course member with role TRAINER
    const createdByWhere: any[] = [eq(courses.createdById, trainerProfileId)];
    if (q) createdByWhere.push(ilike(courses.title, `%${q}%`));
    if (year && year !== 'all') createdByWhere.push(eq(courses.year, Number(year)));
    const createdByExpr = createdByWhere.filter(Boolean);

    const createdList = await db
      .select({ id: courses.id, title: courses.title, year: courses.year, chapter: courses.chapter })
      .from(courses)
      .where(createdByExpr.length ? (createdByExpr.length === 1 ? createdByExpr[0] : and(...createdByExpr as any)) : undefined as any)
      .orderBy(courses.createdAt);

    // Get courseIds where trainer is a member
    const memberCourseRows = await db
      .select({ courseId: courseMembers.courseId })
      .from(courseMembers)
      .where(and(eq(courseMembers.userId, trainerProfileId as any), eq(courseMembers.role, 'TRAINER' as any)));
    const memberCourseIds = Array.from(new Set(memberCourseRows.map(r => String(r.courseId))));

    let memberList: { id: string; title: string; year: number | null; chapter: number | null }[] = [];
    if (memberCourseIds.length) {
      const memberWhere: any[] = [inArray(courses.id, memberCourseIds as any)];
      if (q) memberWhere.push(ilike(courses.title, `%${q}%`));
      if (year && year !== 'all') memberWhere.push(eq(courses.year, Number(year)));
      const memberExpr = memberWhere.filter(Boolean);
      memberList = await db
        .select({ id: courses.id, title: courses.title, year: courses.year, chapter: courses.chapter })
        .from(courses)
        .where(memberExpr.length ? (memberExpr.length === 1 ? memberExpr[0] : and(...memberExpr as any)) : undefined as any)
        .orderBy(courses.createdAt);
    }

    // Merge and de-duplicate
    const mapById = new Map<string, { id: string; title: string; year: number | null; chapter: number | null }>();
    [...createdList, ...memberList].forEach(c => mapById.set(String(c.id), c));
    const list = Array.from(mapById.values());

    if (list.length === 0) return NextResponse.json({ courses: [] });
    const courseIds = list.map((c) => c.id);

    const enCounts = await db
      .select({ courseId: enablers.courseId, cnt: count() })
      .from(enablers)
      .where(inArray(enablers.courseId, courseIds))
      .groupBy(enablers.courseId);
    const enMap = new Map<string, number>(enCounts.map((r) => [String(r.courseId), Number(r.cnt)]));

    // Use-cases reside in useCases table; select via dynamic import to avoid circular
    const { useCases } = await import('@/db/migrations/schemas/schema');
    const ucCounts = await db
      .select({ courseId: useCases.courseId, cnt: count() })
      .from(useCases)
      .where(inArray(useCases.courseId, courseIds))
      .groupBy(useCases.courseId);
    const ucMap = new Map<string, number>(ucCounts.map((r) => [String(r.courseId), Number(r.cnt)]));

    const out = list.map((c) => ({
      id: c.id,
      title: c.title,
      year: c.year,
      chapter: c.chapter,
      enablersCount: enMap.get(String(c.id)) || 0,
      useCasesCount: ucMap.get(String(c.id)) || 0,
    }));

    return NextResponse.json({ courses: out });
  } catch (e) {
    console.error('List courses error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/trainer/courses
// Create a course with optional skills
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title: string | undefined = body?.title;
    const year: number | undefined = body?.year ? Number(body.year) : undefined;
    const chapter: number | undefined = body?.chapter ? Number(body.chapter) : undefined;
    const createdById: string | undefined = body?.createdById;
    const skillNames: string[] = Array.isArray(body?.skills) ? body.skills : [];
    if (!title || !createdById) {
      return NextResponse.json({ error: 'Missing title or createdById' }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const [course] = await tx
        .insert(courses)
        .values({ title, year: year as any, chapter: chapter as any, createdById })
        .returning();

      // Ensure creator is a trainer member of this course
      await tx.insert(courseMembers).values({ courseId: course.id, userId: createdById as any, role: 'TRAINER' as any });

      if (skillNames.length) {
        // Upsert skills by name then attach
        const existing = await tx.select().from(skills).where(inArray(skills.name, skillNames));
        const existingNames = new Set(existing.map((s) => s.name));
        const toInsert = skillNames.filter((n) => !existingNames.has(n)).map((name) => ({ name }));
        if (toInsert.length) await tx.insert(skills).values(toInsert);
        const allSkills = await tx.select().from(skills).where(inArray(skills.name, skillNames));
        if (allSkills.length) {
          await tx.insert(courseSkills).values(
            allSkills.map((s) => ({ courseId: course.id, skillId: s.id }))
          );
        }
      }

      return course;
    });

    return NextResponse.json({ course: result });
  } catch (e) {
    console.error('Create course error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
