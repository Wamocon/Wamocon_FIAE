import { NextRequest } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { reviewDeps } from '@/lib/content-upload/review/context';
import { reviewOptions } from '@/lib/content-upload/review/service';
import { ok } from '@/lib/content-upload/staging/result';
import {
  respond,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { loadRun } from '@/lib/content-upload/staging/runs';

/**
 * GET /api/trainer/content-upload/runs/[runId]/review/options
 * What the selects of the review may offer: the types, the quiz levels and the
 * components with their enablers of the positive list (the database plus what the
 * folder tree of the run would create, marked as new). There is no free input of
 * codes.
 */
export async function GET(
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
    return respond(ok(await reviewOptions(deps, run.data)));
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
