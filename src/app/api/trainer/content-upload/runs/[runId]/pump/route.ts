import { NextRequest } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/guard';
import { uploadDeps } from '@/lib/content-upload/context';
import { fail, ok } from '@/lib/content-upload/result';
import { PUMPABLE_RUN_STATUSES, pumpRun } from '@/lib/content-upload/queue';
import {
  respond,
  readJsonBody,
  uploadErrorResponse,
} from '@/lib/content-upload/route-support';
import { loadRun } from '@/lib/content-upload/runs';

// The call works for about 8 seconds (the budget), a step may take longer.
export const maxDuration = 60;

/**
 * POST /api/trainer/content-upload/runs/[runId]/pump
 * Works the queue of the run for a limited time (budgetMs, default 8000, at most
 * 20000), one step per file. The browser calls it in a loop while the page is open
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
    const deps = uploadDeps();
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
    // The body is optional: no body, or an unreadable one, means the defaults
    let body: { budgetMs?: unknown; closeUpload?: unknown } = {};
    const parsed = await readJsonBody(request);
    if (parsed.ok && parsed.body && typeof parsed.body === 'object') {
      body = parsed.body as typeof body;
    }
    const result = await pumpRun(deps, run.data.id, {
      budgetMs: typeof body.budgetMs === 'number' ? body.budgetMs : undefined,
      closeUpload: body.closeUpload === true,
    });
    return respond(ok(result));
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
