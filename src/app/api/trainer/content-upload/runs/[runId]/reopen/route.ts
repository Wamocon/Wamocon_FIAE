import { NextRequest } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { reviewDeps } from '@/lib/content-upload/review/context';
import { fail, ok } from '@/lib/content-upload/staging/result';
import {
  respond,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { loadRun } from '@/lib/content-upload/staging/runs';

/**
 * POST /api/trainer/content-upload/runs/[runId]/reopen
 * Takes a run in the state applied or failed back to review ("Erneut prüfen"), so
 * that decisions can be changed and a further apply can follow. In the same step
 * the version of the decisions goes up and the hash of the last dry run is
 * cleared, like at every change of a decision. 409 RUN_STATE for any other state.
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
    const result = await deps.review.reopenRun(run.data.id);
    if (!result.ok) {
      return respond(
        result.reason === 'RUN_NOT_FOUND'
          ? fail(404, 'Run not found')
          : fail(
              409,
              `A run in the state ${result.status} cannot be taken back to review`,
              'RUN_STATE'
            )
      );
    }
    return respond(ok({ version: result.version }));
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
