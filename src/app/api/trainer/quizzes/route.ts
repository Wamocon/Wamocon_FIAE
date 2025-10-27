import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { quizzes, modules, lessons } from '@/db/migrations/schemas/schema';
import { and, desc, eq, ilike, isNotNull, or } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim();
    const year = searchParams.get('year');

    const where = and(
      q ? ilike(quizzes.title, `%${q}%`) : undefined,
      year && year !== 'all' ? eq(quizzes.training_year, Number(year)) : undefined,
    );

    const rows = await db
      .select({
        id: quizzes.id,
        title: quizzes.title,
        quiz_type: quizzes.quiz_type,
        training_year: quizzes.training_year,
        time_limit_minutes: quizzes.time_limit_minutes,
        module_id: quizzes.module_id,
        lesson_id: quizzes.lesson_id,
        module_title: modules.title,
        lesson_title: lessons.title,
        updated_at: quizzes.updated_at,
      })
      .from(quizzes)
      .leftJoin(modules, eq(modules.id, quizzes.module_id))
      .leftJoin(lessons, eq(lessons.id, quizzes.lesson_id))
      .where(where as any)
      .orderBy(desc(quizzes.updated_at));

    return NextResponse.json({ quizzes: rows });
  } catch (e) {
    console.error('List quizzes error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload: any = {
      title: String(body.title || '').trim(),
      quiz_type: body.quiz_type,
      training_year: Number(body.training_year),
      time_limit_minutes: body.time_limit_minutes ? Number(body.time_limit_minutes) : 30,
      module_id: body.module_id || null,
      lesson_id: body.lesson_id || null,
    };

    if (!payload.title) return NextResponse.json({ error: 'Title required' }, { status: 400 });
    if (!payload.quiz_type || !['mini', 'big'].includes(payload.quiz_type)) {
      return NextResponse.json({ error: 'quiz_type must be mini or big' }, { status: 400 });
    }
    if (!payload.training_year || ![1, 2, 3].includes(Number(payload.training_year))) {
      return NextResponse.json({ error: 'training_year must be 1..3' }, { status: 400 });
    }

    const [row] = await db.insert(quizzes).values(payload).returning();
    return NextResponse.json({ quiz: row }, { status: 201 });
  } catch (e) {
    console.error('Create quiz error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
