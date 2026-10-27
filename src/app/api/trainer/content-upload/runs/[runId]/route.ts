import { NextRequest } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/guard';
import { uploadDeps } from '@/lib/content-upload/context';
import { ok } from '@/lib/content-upload/result';
import {
  respond,
  uploadErrorResponse,
} from '@/lib/content-upload/route-support';
import { getRunWithProgress, loadRun } from '@/lib/content-upload/runs';

/**
 * GET /api/trainer/content-upload/runs/[runId]
 * The run and its progress: the number of files per state. Only the own runs
 * (a SUPER_ADMIN sees all), a foreign run answers 404.
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
    const deps = uploadDeps();
    const run = await loadRun(deps, session, runId);
    if (!run.ok) return respond(run);
    return respond(ok(await getRunWithProgress(deps, run.data)));
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
