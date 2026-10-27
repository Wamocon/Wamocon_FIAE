import { NextRequest } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { uploadDeps } from '@/lib/content-upload/staging/context';
import { issueUploadUrls } from '@/lib/content-upload/staging/files';
import {
  respond,
  readJsonBody,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { loadRun } from '@/lib/content-upload/staging/runs';

/**
 * POST /api/trainer/content-upload/runs/[runId]/upload-urls
 * Signed upload urls for up to 50 announced files: { fileIds: [...] }. Made
 * right before the upload, never with upsert, 60 requests per minute and person.
 * No url for a file of a foreign or discarded run.
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
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    return respond(await issueUploadUrls(deps, session, run.data, parsed.body));
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
