import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { countDistinct, desc, eq } from 'drizzle-orm';
import { profiles, quizzes, quizSubmissions, enablerQuizLinks, enablers } from '@/db/migrations/schemas/schema';
import { requireCatalogScope } from '@/lib/catalog/scope';
import { requireTraineeScopeCondition } from '@/lib/auth/trainee-scope-conditions';
import { quizSubmissionsWhere } from '@/lib/trainer/pending-reviews';
import {
  parseCourse,
  parsePaging,
  parseQuizType,
  parseSearch,
} from '@/lib/trainer/review-paging';

// GET /api/trainer/quiz-submissions?onlyPending=true&q=&limit=&offset=
// One page of the quiz submissions, newest first, and the total of the same
// filter (WMCNL-2999): the list used to end at 200 rows without a hint while
// the dashboard counted every open one. `q` narrows the list to a trainee or a
// quiz whose name contains the text (WMCNL-3001), `quizType=LESSON|GLOBAL` to one
// kind of quiz, `course=<id>|global` to the quizzes of one course (Fragenkomplex)
// or to the global ones.
export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { searchParams } = new URL(req.url);
    const onlyPending = searchParams.get('onlyPending') === 'true';
    const { limit, offset } = parsePaging(searchParams);
    const search = parseSearch(searchParams);
    const quizType = parseQuizType(searchParams);
    const course = parseCourse(searchParams);

    const catalogScope = await requireCatalogScope(session, req);
    if (isErrorResponse(catalogScope)) return catalogScope;

    // Only trainees of the caller's organization (the super admin sees every
    // one) and, with a chosen occupation (x-catalog), of that occupation. The
    // trainees of the caller's courses are not added: a course can hold
    // trainees of other organizations, and every trainee inside the scope is
    // already part of the organization list.
    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;

    // The same filter the dashboard counts the pending reviews with
    const where = quizSubmissionsWhere(
      catalogScope,
      traineeScope.condition,
      onlyPending,
      search,
      quizType,
      course
    );
    const [counted] = await db
      .select({ c: countDistinct(quizSubmissions.id) })
      .from(quizSubmissions)
      .innerJoin(profiles, eq(quizSubmissions.traineeId, profiles.id))
      .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
      .where(where);
    const total = Number(counted?.c) || 0;

    const rows = await db
      .select({
        id: quizSubmissions.id,
        traineeId: quizSubmissions.traineeId,
        quizId: quizSubmissions.quizId,
        score: quizSubmissions.score,
        isReviewed: quizSubmissions.isReviewed,
        submittedAt: quizSubmissions.submittedAt,
        attemptNumber: quizSubmissions.attemptNumber,
        traineeName: profiles.fullName,
        quizTitle: quizzes.title,
        quizType: quizzes.quizType,
        difficulty: enablerQuizLinks.difficulty,
        enablerTitle: enablers.title,
      })
      .from(quizSubmissions)
      .innerJoin(profiles, eq(quizSubmissions.traineeId, profiles.id))
      .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
      .leftJoin(enablerQuizLinks, eq(enablerQuizLinks.quizId, quizSubmissions.quizId))
      .leftJoin(enablers, eq(enablers.id, enablerQuizLinks.enablerId))
      .where(where)
      .orderBy(desc(quizSubmissions.submittedAt), desc(quizSubmissions.id))
      .limit(limit)
      .offset(offset);

    // enabler_quiz_links.quiz_id is unique, so a quiz joins to one enabler and
    // a submission to one row. The filter keeps a page right should that change.
    const seen = new Set<string>();
    const submissions = rows.filter(r => {
      const id = String(r.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return NextResponse.json({ submissions, total, limit, offset });
  } catch (e) {
    console.error('Trainer quiz submissions GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
