import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
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
import { getUserOrgId, verifyPlatformOwner } from '@/lib/auth-helpers';
import {
  requireTraineeScopeCondition,
  traineeIdInScope,
  traineeIdsInScope,
} from '@/lib/auth/trainee-scope-conditions';
import {
  catalogCacheKey,
  catalogCondition,
  ensureContentInScope,
  getContentCatalogId,
  requireCatalogScope,
} from '@/lib/catalog/scope';

export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const scope = await requireCatalogScope(session, req);
    if (isErrorResponse(scope)) return scope;

    // The assignments are counted for trainees of the caller's organization
    // (the super admin: every one) and chosen occupation only
    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;
    const assignedToScope = traineeIdInScope(
      quizAssignments.traineeId,
      traineeScope.condition
    );

    const { searchParams } = new URL(req.url);
    const trainerId = session.id;
    const q = searchParams.get('q')?.trim();
    const year = searchParams.get('year');

    const cacheKey = `trainer_quizzes_${trainerId}_${q || ''}_${year || ''}_${catalogCacheKey(scope)}`;
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
              sql<number>`count(distinct case when ${assignedToScope} then ${quizAssignments.id} end)`.as(
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
            return and(
              textFilter,
              yearFilter,
              catalogCondition(quizzes.trainingCatalogId, scope)
            );
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
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const body = await req.json();
    const trainer_id = session.id;
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

    if (!(await verifyPlatformOwner(trainer_id))) {
      return NextResponse.json(
        { error: 'Only platform administrators can manage curriculum content' },
        { status: 403 }
      );
    }

    const organizationId = await getUserOrgId(trainer_id);

    if (!title)
      return NextResponse.json({ error: 'title required' }, { status: 400 });
    if (!quiz_type || !['mini', 'big'].includes(quiz_type)) {
      return NextResponse.json(
        { error: 'quiz_type must be mini or big' },
        { status: 400 }
      );
    }

    const qt = quiz_type === 'mini' ? 'LESSON' : 'GLOBAL';

    // A new quiz belongs to the active catalog; a mini quiz follows the
    // catalog of its enabler, which must lie inside the caller's catalogs.
    const scope = await requireCatalogScope(session, req);
    if (isErrorResponse(scope)) return scope;
    let quizCatalogId = scope.activeCatalogId;

    // Only trainees of the caller's organization (the super admin: any) and of
    // the chosen occupation can be assigned, checked before anything is created
    if (qt === 'GLOBAL' && Array.isArray(assignedTraineeIds)) {
      const allowed = await traineeIdsInScope(session, req, assignedTraineeIds);
      if (isErrorResponse(allowed)) return allowed;
      if (assignedTraineeIds.some(tid => !allowed.has(String(tid)))) {
        return NextResponse.json(
          { error: 'Trainee not found' },
          { status: 404 }
        );
      }
    }
    if (qt === 'LESSON' && enabler_id) {
      const denied = await ensureContentInScope(
        scope,
        'enabler',
        String(enabler_id)
      );
      if (denied) return denied;
      quizCatalogId =
        (await getContentCatalogId('enabler', String(enabler_id))) ??
        quizCatalogId;
    }

    const [qz] = await db
      .insert(quizzes)
      .values({
        trainingCatalogId: quizCatalogId,
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
        traineeId: String(tid),
        assignedById: trainer_id,
        organizationId,
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
          organizationId,
        }));
        await db.insert(notifications).values(notifValues);
      } catch (notifyErr) {
        console.warn(
          'Failed to notify trainees for quiz assignment',
          notifyErr
        );
      }
    }

    // Bust cached GETs so the next read returns fresh data
    apiCache.invalidate('trainer_quizzes');
    apiCache.invalidate('trainee_quizzes');

    return NextResponse.json({ id: qz.id }, { status: 201 });
  } catch (e) {
    console.error('Create quiz error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
