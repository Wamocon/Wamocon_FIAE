import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, ilike, inArray } from 'drizzle-orm';
import { lessons, modules, subLessons } from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim();
    const year = searchParams.get('year'); // '1' | '2' | '3' or undefined

    // Load modules with optional filters
    const whereClauses: any[] = [];
    if (year && year !== 'all') whereClauses.push(eq(modules.training_year, Number(year)));
    if (q) whereClauses.push(ilike(modules.title, `%${q}%`));

    const modRows = await db
      .select({ id: modules.id, title: modules.title, training_year: modules.training_year, order_index: modules.order_index })
      .from(modules)
      .where(whereClauses.length ? (whereClauses.length === 1 ? whereClauses[0] : and(...whereClauses)) : undefined as any)
      .orderBy(modules.order_index);

    if (modRows.length === 0) return NextResponse.json({ modules: [] });

    // For each module, get lessons and sub-lesson counts
    const out: Array<{ id: string; title: string; training_year: number; lessonsCount: number; subLessonsCount: number; lessons: Array<{ id: string; title: string; subLessonsCount: number }> }> = [];

    for (const m of modRows) {
      const ls = await db
        .select({ id: lessons.id, title: lessons.title })
        .from(lessons)
        .where(eq(lessons.module_id, m.id))
        .orderBy(lessons.order_index);

      const lessonIds = ls.map(l => l.id);
      let subCountsByLesson: Record<string, number> = {};
      if (lessonIds.length > 0) {
        const subs = await db
          .select({ lesson_id: subLessons.lesson_id, cnt: count() })
          .from(subLessons)
          .where(inArray(subLessons.lesson_id, lessonIds))
          .groupBy(subLessons.lesson_id);
        subCountsByLesson = subs.reduce((acc, r) => {
          acc[String(r.lesson_id)] = Number(r.cnt);
          return acc;
        }, {} as Record<string, number>);
      }

      const lessonsWithCounts = ls.map(l => ({ id: l.id, title: l.title, subLessonsCount: subCountsByLesson[l.id] || 0 }));
      const lessonsCount = ls.length;
      const subLessonsCount = Object.values(subCountsByLesson).reduce((a, b) => a + b, 0);

  out.push({ id: m.id, title: m.title, training_year: Number(m.training_year ?? 0), lessonsCount, subLessonsCount, lessons: lessonsWithCounts });
    }

    return NextResponse.json({ modules: out });
  } catch (e) {
    console.error('Trainer content API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
