import { NextRequest } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/guard';
import { uploadDeps } from '@/lib/content-upload/context';
import { announceFiles, listRunFiles } from '@/lib/content-upload/files';
import {
  respond,
  readJsonBody,
  uploadErrorResponse,
} from '@/lib/content-upload/route-support';
import { loadRun } from '@/lib/content-upload/runs';

/**
 * GET /api/trainer/content-upload/runs/[runId]/files?offset=&limit=
 * The files of the run (at most 500 per call): id, cleaned relative path, size,
 * hash, state. The browser compares this list with its own to resume an upload.
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
    const search = request.nextUrl.searchParams;
    return respond(
      await listRunFiles(deps, run.data, {
        offset: search.get('offset'),
        limit: search.get('limit'),
      })
    );
  } catch (error) {
    return uploadErrorResponse(error);
  }
}

/**
 * POST /api/trainer/content-upload/runs/[runId]/files
 * Announces up to 50 files: { files: [{ path, size, sha256, lastModified }] }.
 * One verdict per file, a file that cannot be taken is reported with its reason
 * and never stops the others. Announcing the same file again is harmless.
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
    return respond(await announceFiles(deps, run.data, parsed.body));
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
