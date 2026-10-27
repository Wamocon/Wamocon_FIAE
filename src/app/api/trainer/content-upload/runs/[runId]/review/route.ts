import { NextRequest } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { reviewDeps } from '@/lib/content-upload/review/context';
import { parseFilter } from '@/lib/content-upload/review/filter';
import { reviewList } from '@/lib/content-upload/review/service';
import { ok } from '@/lib/content-upload/staging/result';
import {
  respond,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { loadRun } from '@/lib/content-upload/staging/runs';

/**
 * GET /api/trainer/content-upload/runs/[runId]/review
 * One page of the review list of a run, with the counts of the whole run and
 * the version of the decisions. Query: band, type, component, status, duplicates,
 * q, sort, page, pageSize (a value that is not known filters nothing). Only
 * metadata, the proposed assignment, the reasons and the confidence: no excerpt,
 * no storage path, no text of a document and no part of a solution.
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
    const filter = parseFilter(new URL(request.url).searchParams);
    return respond(ok(await reviewList(deps, run.data, filter)));
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
