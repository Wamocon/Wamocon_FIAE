import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, ilike, sql, count } from 'drizzle-orm';
import {
  quizzes,
  enablerQuizzes,
  enablers,
  courses,
  questions,
  options,
  quizAssignments,
  quizMembers,
  notifications,
} from '@/db/migrations/schemas/schema';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    const q = searchParams.get('q')?.trim();
    const year = searchParams.get('year');

    if (!trainerId) {
      return NextResponse.json(
        { error: 'trainerId required' },
        { status: 400 }
      );
    }

    const cacheKey = `trainer_quizzes_${trainerId}_${q || ''}_${year || ''}`;
    const cached = await apiCache.getOrFetch(
      cacheKey,
      async () => {
        const rows = await db
          .select({
            id: quizzes.id,
            title: quizzes.title,
            quizType: quizzes.quizType,
            isActive: quizzes.isActive,
            enablerId: enablerQuizzes.enablerId,
            enablerTitle: enablers.title,
            courseYear: courses.year,
            updatedAt: quizzes.updatedAt,
            createdAt: quizzes.createdAt,
            assignedCount:
              sql<number>`count(distinct ${quizAssignments.id})`.as(
                'assigned_count'
              ),
          })
          .from(quizzes)
          .leftJoin(enablerQuizzes, eq(enablerQuizzes.quizId, quizzes.id))
          .leftJoin(enablers, eq(enablerQuizzes.enablerId, enablers.id))
          .leftJoin(courses, eq(enablers.courseId, courses.id))
          .leftJoin(quizAssignments, eq(quizAssignments.quizId, quizzes.id))
          .leftJoin(quizMembers, eq(quizMembers.quizId, quizzes.id))
          .where(() => {
            const textFilter = q
              ? ilike(quizzes.title, `%${q}%`)
              : (sql`true` as any);
            const yearFilter =
              year && year !== 'all'
                ? eq(courses.year, Number(year))
                : (sql`true` as any);
            return and(textFilter, yearFilter);
          })
          .groupBy(
            quizzes.id,
            quizzes.title,
            quizzes.quizType,
            quizzes.isActive,
            enablerQuizzes.enablerId,
            enablers.title,
            courses.year,
            quizzes.updatedAt,
            quizzes.createdAt
          )
          .orderBy(desc(quizzes.updatedAt), desc(quizzes.createdAt))
          .limit(200);

        const out = rows.map(r => ({
          id: r.id,
          title: r.title,
          quiz_type: r.quizType === 'LESSON' ? 'mini' : 'big',
          is_active: r.isActive,
          training_year: r.courseYear ?? 0,
          time_limit_minutes: 0,
          module_id: r.enablerId || null,
          lesson_id: null,
          module_title: r.enablerTitle || null,
          lesson_title: null,
          assigned_count: Number(r.assignedCount || 0),
          created_at: r.createdAt,
        }));

        return { quizzes: out };
      },
      ApiCache.TTL.MEDIUM
    );

    return NextResponse.json(cached, { headers: cacheHeaders.medium });
  } catch (e) {
    console.error('List quizzes error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const trainer_id = (body?.trainer_id || body?.trainerId) as
      | string
      | undefined;
    const title = String(body?.title || '').trim();
    const quiz_type = (body?.quiz_type || body?.quizType) as 'mini' | 'big';
    const enabler_id = body?.enabler_id || body?.enablerId || null;
    const is_active = Boolean(body?.is_active ?? body?.isActive ?? true);
    const questionsPayload = (body?.questions || []) as Array<{
      question_text: string;
      options: string[];
      correct_index: number;
    }>;
    const assignedTraineeIds = (body?.assigned_trainee_ids ||
      body?.assignedTraineeIds ||
      []) as string[];

    if (!trainer_id)
      return NextResponse.json(
        { error: 'trainer_id required' },
        { status: 400 }
      );
    if (!title)
      return NextResponse.json({ error: 'title required' }, { status: 400 });
    if (!quiz_type || !['mini', 'big'].includes(quiz_type)) {
      return NextResponse.json(
        { error: 'quiz_type must be mini or big' },
        { status: 400 }
      );
    }

    const qt = quiz_type === 'mini' ? 'LESSON' : 'GLOBAL';

    const [qz] = await db
      .insert(quizzes)
      .values({
        title,
        quizType: qt,
        createdById: trainer_id,
        isActive: is_active,
      })
      .returning();

    if (qt === 'LESSON') {
      if (!enabler_id)
        return NextResponse.json(
          { error: 'enabler_id required for mini quiz' },
          { status: 400 }
        );
      await db
        .insert(enablerQuizzes)
        .values({ enablerId: enabler_id, quizId: qz.id });
    }

    // Create questions/options if provided
    if (Array.isArray(questionsPayload) && questionsPayload.length > 0) {
      let order = 1;
      for (const q of questionsPayload) {
        const [qRow] = await db
          .insert(questions)
          .values({
            quizId: qz.id,
            questionText: q.question_text,
            orderIndex: order++,
          })
          .returning();
        // Create options, mark correct
        for (let i = 0; i < q.options.length; i++) {
          const optText = q.options[i];
          await db.insert(options).values({
            questionId: qRow.id,
            optionText: optText,
            isCorrect: i === Number(q.correct_index),
          });
        }
      }
    }

    // Assign trainees for GLOBAL quizzes if provided
    if (
      qt === 'GLOBAL' &&
      Array.isArray(assignedTraineeIds) &&
      assignedTraineeIds.length > 0
    ) {
      const values = assignedTraineeIds.map(tid => ({
        quizId: qz.id,
        traineeId: tid,
        assignedById: trainer_id,
      }));
      await db.insert(quizAssignments).values(values).onConflictDoNothing();

      // Notify assigned trainees
      try {
        const notifValues = assignedTraineeIds.map(tid => ({
          userId: tid,
          actorId: trainer_id,
          type: 'GLOBAL_QUIZ_ASSIGNED',
          title: 'Neues Quiz zugewiesen',
          message: `Dir wurde ein neues Quiz zugewiesen: "${title}"`,
          linkUrl: `/trainee/quizzes/${qz.id}`,
          context: { quizId: qz.id },
        }));
        await db.insert(notifications).values(notifValues);
      } catch (notifyErr) {
        console.warn(
          'Failed to notify trainees for quiz assignment',
          notifyErr
        );
      }
    }

    // Bust the cached GET so the next read returns fresh data
    apiCache.invalidate('trainer_quizzes');

    return NextResponse.json({ id: qz.id }, { status: 201 });
  } catch (e) {
    console.error('Create quiz error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
