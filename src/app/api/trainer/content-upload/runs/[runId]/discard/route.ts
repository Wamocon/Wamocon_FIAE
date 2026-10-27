import { NextRequest, NextResponse } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { uploadDeps } from '@/lib/content-upload/staging/context';
import {
  respond,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { discardRun, loadRun, runDto } from '@/lib/content-upload/staging/runs';

/**
 * POST /api/trainer/content-upload/runs/[runId]/discard
 * Discards the run: its objects are removed from the staging bucket at once, its
 * rows after 7 days. Discarding a run twice is fine.
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
    const discarded = await discardRun(deps, run.data);
    return discarded.ok
      ? NextResponse.json({ run: runDto(discarded.data) })
      : respond(discarded);
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
