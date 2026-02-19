import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import {
  lessons,
  modules,
  progress,
  subLessons,
} from '@/db/migrations/schemas/schema';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    const data = await apiCache.getOrFetch(
      `trainee_lessons_${userId}`,
      async () => {
        // Fetch lessons + modules in batch
        const [ls, mods] = await Promise.all([
          db
            .select({
              id: lessons.id,
              title: lessons.title,
              module_id: lessons.module_id,
            })
            .from(lessons),
          db.select({ id: modules.id, title: modules.title }).from(modules),
        ]);

        const moduleMap = new Map<string, string>();
        mods.forEach(m => moduleMap.set(m.id, m.title));

        if (ls.length === 0) return [];

        const lessonIds = ls.map(l => l.id);

        // Batch: get ALL sub-lessons grouped by lesson_id (single query)
        const allSubs = await db
          .select({ id: subLessons.id, lessonId: subLessons.lesson_id })
          .from(subLessons)
          .where(sql`${subLessons.lesson_id} IN ${lessonIds}`);

        const subsByLesson = new Map<string, string[]>();
        for (const s of allSubs) {
          const lid = String(s.lessonId);
          if (!subsByLesson.has(lid)) subsByLesson.set(lid, []);
          subsByLesson.get(lid)!.push(String(s.id));
        }

        // Batch: get ALL progress for this user (single query)
        const allSubIds = allSubs.map(s => s.id);
        const userProgress =
          allSubIds.length > 0
            ? await db
                .select({ subLessonId: progress.sub_lesson_id })
                .from(progress)
                .where(
                  and(
                    eq(progress.user_id, userId),
                    sql`${progress.sub_lesson_id} IN ${allSubIds}`
                  )
                )
            : [];
        const completedSubLessons = new Set(
          userProgress.map(p => String(p.subLessonId))
        );

        return ls.map(l => {
          const moduleId = String(l.module_id ?? '');
          const subs = subsByLesson.get(String(l.id)) || [];
          const completed =
            subs.length > 0 &&
            subs.every(subId => completedSubLessons.has(subId));

          return {
            id: l.id,
            title: l.title,
            moduleTitle: moduleMap.get(moduleId) || 'Unbekanntes Modul',
            moduleId,
            completed,
            type: 'lesson',
            ref: null,
          };
        });
      },
      ApiCache.TTL.MEDIUM
    );

    return NextResponse.json(data, { headers: cacheHeaders.medium });
  } catch (e) {
    console.error('Lessons API error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
