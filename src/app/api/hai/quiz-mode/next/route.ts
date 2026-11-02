/**
 * HAI quiz mode: the next question.
 *
 * POST /api/hai/quiz-mode/next
 *
 * Body: { enablerId?: uuid, topic?: string, exclude?: uuid[] }
 *  - enablerId: ask only about this enabler (the chat is open in it)
 *  - topic: words from the request ("SQL"), matched against the titles and
 *    the question text
 *  - exclude: the questions already asked in this session, so none comes back
 *    until all are through
 *
 * Answer: { status: 'ok', question, total, remaining } with the question as
 * the person may see it BEFORE the attempt (text and options in a random
 * order, no is_correct, no explanation), or { status: 'empty', reason } or
 * { status: 'exhausted', total } without a question.
 *
 * A practice without grading: nothing is written, no submission, no progress.
 * The access rules are those of the real lesson quiz (see lib/hai/quizMode/
 * access.ts). The solution comes only from POST .../answer, after an attempt.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { requireProPlan } from '@/lib/auth-helpers';
import { DENIAL_CODES } from '@/lib/hai/denial';
import {
  QUIZ_MODE_CANDIDATE_BATCH,
  isAskable,
  selectCandidates,
  shuffled,
  toPublicQuestion,
} from '@/lib/hai/quizMode/logic';
import {
  loadQuestionSources,
  loadQuizCandidates,
} from '@/lib/hai/quizMode/access';
import { quizModeRateLimit } from '@/lib/hai/quizMode/limits';
import { parseNextBody } from '@/lib/hai/quizMode/validate';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
  // The person is the session, never a field of the request
  const me = await requireUser(req);
  if (isErrorResponse(me)) return me;

  const limited = quizModeRateLimit(me.id, 'next');
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
    const parsed = parseNextBody(raw);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { enablerId, topic, exclude } = parsed.value;

    const candidates = await loadQuizCandidates(me, req, enablerId);
    if (candidates instanceof Response) return candidates;

    const { remaining, total, asked } = selectCandidates(candidates, {
      topic,
      exclude,
    });
    if (total === 0) {
      return NextResponse.json(
        {
          status: 'empty',
          question: null,
          reason:
            candidates.length > 0 && topic ? 'no_topic_match' : 'no_content',
        },
        { headers: NO_STORE }
      );
    }

    // A question without a usable option set is skipped, the search goes on in
    // batches so one defective question does not end the session
    const order = shuffled(remaining);
    for (let i = 0; i < order.length; i += QUIZ_MODE_CANDIDATE_BATCH) {
      const sources = await loadQuestionSources(
        order.slice(i, i + QUIZ_MODE_CANDIDATE_BATCH)
      );
      const source = sources.find(isAskable);
      if (source) {
        return NextResponse.json(
          {
            status: 'ok',
            // Built field by field: the solution cannot slip in here
            question: toPublicQuestion(source),
            total,
            remaining: remaining.length,
          },
          { headers: NO_STORE }
        );
      }
    }

    return NextResponse.json(
      asked > 0
        ? { status: 'exhausted', question: null, total }
        : { status: 'empty', question: null, reason: 'no_content' },
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error(
      'HAI quiz mode next error',
      e instanceof Error ? e.message : 'unknown'
    );
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
