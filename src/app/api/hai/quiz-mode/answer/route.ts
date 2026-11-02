/**
 * HAI quiz mode: check an attempt.
 *
 * POST /api/hai/quiz-mode/answer
 *
 * Body: { questionId: uuid, optionIds: uuid[] }  (one option, several for a
 * question with more than one right option)
 *
 * Answer, solution released: { solutionWithheld: false, correct,
 * selectedOptionIds, correctOptionIds, explanation, multiple, enablerId }.
 * Answer, solution withheld: { solutionWithheld: true, correct,
 * selectedOptionIds, multiple, correctCount, enablerId }, right or wrong and
 * nothing else. The solution and the explanation are part of the released
 * answer and of no other. The real lesson quiz holds its key back until the
 * quiz is passed, the quiz mode follows the same rule with the same definition
 * of "passed" (hasPassedQuiz): for a trainee the solution comes once the quiz
 * of the question (not another one) is passed by the person of the session, a
 * trainer always sees it. While it is withheld the attempts of a person at one
 * question are limited (429 QUESTION_ATTEMPTS_EXCEEDED, see limits.ts). The
 * question must pass the same access checks as when it was asked (catalog
 * scope, course membership, order of work, chain of the quizzes), so a
 * question id of a locked enabler or of another occupation gets nothing.
 *
 * A practice without grading: nothing is written (no quiz_submissions, no
 * answers, no progress, no notification).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { requireProPlan } from '@/lib/auth-helpers';
import { DENIAL_CODES } from '@/lib/hai/denial';
import { buildAnswerBody, selectionBelongsTo } from '@/lib/hai/quizMode/logic';
import { authorizeQuestion } from '@/lib/hai/quizMode/access';
import {
  quizModeAttemptLimit,
  quizModeRateLimit,
} from '@/lib/hai/quizMode/limits';
import { parseAnswerBody } from '@/lib/hai/quizMode/validate';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
  // The person is the session, never a field of the request
  const me = await requireUser(req);
  if (isErrorResponse(me)) return me;

  const limited = quizModeRateLimit(me.id, 'answer');
  if (limited) return limited;

  try {
    if (!(await requireProPlan(me.id))) {
      return NextResponse.json(
        {
          error: 'HAI.ai is only available with a PRO subscription.',
          code: DENIAL_CODES.PRO_REQUIRED,
        },
        { status: 403 }
      );
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    const parsed = parseAnswerBody(raw);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { questionId, optionIds } = parsed.value;

    const authorized = await authorizeQuestion(me, req, questionId);
    if (authorized instanceof Response) return authorized;
    const { source, solutionReleased } = authorized;

    // An option has to belong to the question, and a choice question takes one
    const multiple = source.options.filter(o => o.isCorrect).length > 1;
    if (
      !selectionBelongsTo(source, optionIds) ||
      (!multiple && optionIds.length !== 1)
    ) {
      return NextResponse.json({ error: 'Invalid optionIds' }, { status: 400 });
    }

    // While the solution is withheld, a verdict is all the person gets, so
    // the number of attempts at one question is limited (else the options
    // could be tried one after the other). Counted only for a graded attempt.
    if (!solutionReleased) {
      const tooMany = quizModeAttemptLimit(me.id, source.id);
      if (tooMany) return tooMany;
    }

    return NextResponse.json(
      buildAnswerBody(source, optionIds, solutionReleased),
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error(
      'HAI quiz mode answer error',
      e instanceof Error ? e.message : 'unknown'
    );
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
