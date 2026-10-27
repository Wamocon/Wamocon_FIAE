import { NextRequest } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { reviewDeps } from '@/lib/content-upload/review/context';
import { pumpReviewRun } from '@/lib/content-upload/review/steps';
import { fail, ok } from '@/lib/content-upload/staging/result';
import { PUMPABLE_RUN_STATUSES } from '@/lib/content-upload/staging/queue';
import {
  respond,
  readJsonBody,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { loadRun } from '@/lib/content-upload/staging/runs';
import { checkRateLimit } from '@/lib/rate-limit';

// The call works for about 8 seconds (the budget), a step may take longer.
export const maxDuration = 60;

/**
 * POST /api/trainer/content-upload/runs/[runId]/pump
 * Works the queue of the run for a limited time (budgetMs, default 8000, at most
 * 20000), one step per file: check the upload, read the file and apply the rule
 * stage (src/lib/content-upload/review/steps.ts). The browser calls it in a loop while the page is open
 * and sends closeUpload: true once everything is announced and uploaded. The body
 * is optional. Any number of calls at the same time is safe.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const session = await requireCurriculumEditor(request);
  if (isErrorResponse(session)) return session;
  const off = contentUploadDisabledResponse();
  if (off) return off;
  try {
    const { runId } = await params;
    const deps = reviewDeps();
    const run = await loadRun(deps, session, runId);
    if (!run.ok) return respond(run);
    if (!PUMPABLE_RUN_STATUSES.includes(run.data.status)) {
      return respond(
        fail(
          409,
          `Nothing is processed while the run is ${run.data.status}`,
          'RUN_STATE'
        )
      );
    }
    // Each call may work for 20 seconds: a person cannot start them without limit
    const burst = checkRateLimit(`content-upload-pump:${session.id}`, {
      limit: 120,
      windowMs: 60_000,
    });
    if (!burst.allowed) {
      return respond(
        fail(429, 'Too many pump calls', 'RATE_LIMITED', {
          retryAfterSec: burst.retryAfterSec,
        })
      );
    }
    // The body is optional: no body, or an unreadable one, means the defaults
    let body: { budgetMs?: unknown; closeUpload?: unknown } = {};
    const parsed = await readJsonBody(request);
    if (parsed.ok && parsed.body && typeof parsed.body === 'object') {
      body = parsed.body as typeof body;
    }
    const result = await pumpReviewRun(deps, run.data.id, {
      budgetMs: typeof body.budgetMs === 'number' ? body.budgetMs : undefined,
      closeUpload: body.closeUpload === true,
    });
    return respond(ok(result));
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
