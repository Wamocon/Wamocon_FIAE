/**
 * HAI quiz mode: check an attempt.
 *
 * POST /api/hai/quiz-mode/answer
 *
 * Body: { questionId: uuid, optionIds: uuid[] }  (one option, several for a
 * question with more than one right option)
 *
 * Answer: { correct, selectedOptionIds, correctOptionIds, explanation,
 * multiple, enablerId }. The solution and the explanation are part of this
 * answer and of no other: they come only after the attempt. The question must
 * pass the same access checks as when it was asked (catalog scope, course
 * membership, order of work, chain of the quizzes), so a question id of a
 * locked enabler or of another occupation gets nothing.
 *
 * A practice without grading: nothing is written (no quiz_submissions, no
 * answers, no progress, no notification).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { requireProPlan } from '@/lib/auth-helpers';
import { gradeAnswer, selectionBelongsTo } from '@/lib/hai/quizMode/logic';
import { authorizeQuestion } from '@/lib/hai/quizMode/access';
import { quizModeRateLimit } from '@/lib/hai/quizMode/limits';
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
        { error: 'HAI.ai is only available with a PRO subscription.' },
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

    const source = await authorizeQuestion(me, req, questionId);
    if (source instanceof Response) return source;

    // An option has to belong to the question, and a choice question takes one
    const multiple = source.options.filter(o => o.isCorrect).length > 1;
    if (
      !selectionBelongsTo(source, optionIds) ||
      (!multiple && optionIds.length !== 1)
    ) {
      return NextResponse.json({ error: 'Invalid optionIds' }, { status: 400 });
    }

    const verdict = gradeAnswer(source, optionIds);
    return NextResponse.json(
      {
        correct: verdict.correct,
        selectedOptionIds: optionIds,
        correctOptionIds: verdict.correctOptionIds,
        explanation: verdict.explanation,
        multiple,
        enablerId: source.enablerId,
      },
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
