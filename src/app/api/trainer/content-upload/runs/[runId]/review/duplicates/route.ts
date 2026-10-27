import { NextRequest } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { reviewDeps } from '@/lib/content-upload/review/context';
import { reviewDuplicates } from '@/lib/content-upload/review/service';
import { ok } from '@/lib/content-upload/staging/result';
import {
  respond,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { loadRun } from '@/lib/content-upload/staging/runs';

/**
 * GET /api/trainer/content-upload/runs/[runId]/review/duplicates
 * The groups of versions of a run (two or more files with the same content key)
 * with the suggested version, the reasons for the suggestion (or for the lack of
 * one) and the decision of each member. The time of change comes from the browser
 * and is not trustworthy.
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
    return respond(ok(await reviewDuplicates(deps, run.data)));
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
