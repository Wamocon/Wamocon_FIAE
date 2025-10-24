import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import { lessons, modules, progress, subLessons } from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    // Fetch lessons with module title
    const ls = await db
      .select({
        id: lessons.id,
        title: lessons.title,
        module_id: lessons.module_id,
      })
      .from(lessons);

    const moduleMap = new Map<string, string>();
    // Preload module titles
    const mods = await db.select({ id: modules.id, title: modules.title }).from(modules);
    mods.forEach(m => moduleMap.set(m.id, m.title));

    // For each lesson, compute completion if all sub-lessons completed by user
    const out = [] as Array<{
      id: string;
      title: string;
      moduleTitle: string;
      moduleId: string;
      completed: boolean;
      type: string;
      ref?: string | null;
    }>;

    for (const l of ls) {
      const subs = await db
        .select({ id: subLessons.id })
        .from(subLessons)
        .where(eq(subLessons.lesson_id, l.id));
      const subIds = subs.map(s => s.id);
      let completed = false;
      if (subIds.length === 0) {
        completed = false;
      } else {
        const [{ value = 0 } = { value: 0 }] = await db
          .select({ value: count() })
          .from(progress)
          .where(and(eq(progress.user_id, userId), inArray(progress.sub_lesson_id, subIds)));
        completed = Number(value) >= subIds.length;
      }
      out.push({
        id: l.id,
        title: l.title,
        moduleTitle: moduleMap.get(l.module_id) || 'Unbekanntes Modul',
        moduleId: l.module_id,
        completed,
        type: 'lesson',
        ref: null,
      });
    }

    return NextResponse.json(out);
  } catch (e) {
    console.error('Lessons API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
