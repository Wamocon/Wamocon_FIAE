import { NextRequest } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { reviewDeps } from '@/lib/content-upload/review/context';
import { writeDecisions } from '@/lib/content-upload/review/decisions';
import { loadReviewContext } from '@/lib/content-upload/review/service';
import { parseDecisionRequest } from '@/lib/content-upload/review/validate';
import { fail } from '@/lib/content-upload/staging/result';
import {
  respond,
  readJsonBody,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { loadRun } from '@/lib/content-upload/staging/runs';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * POST /api/trainer/content-upload/runs/[runId]/decisions
 * Writes decisions while the run is in the state review (409 otherwise), for the
 * version of the decisions the person saw (409 when it changed).
 * Body: { expectedVersion, command, ... } with one of the commands
 *   set           { items: [{ fileId, action, assignment?, note? }] }
 *   accept_high   every undecided file in the band high that is no version of another
 *   bulk          { action: reject | defer, fileIds }
 *   assign        { fileIds, assignment }   corrects the assignment and accepts
 *   duplicate     { key, keepFileId | null }   keeps one version, skips the others
 *   accept_newest the suggested version of every group that has one
 * Every write raises the version and clears the hash of the last dry run.
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
    const burst = checkRateLimit(`content-upload-decisions:${session.id}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!burst.allowed) {
      return respond(
        fail(429, 'Too many requests', 'RATE_LIMITED', {
          retryAfterSec: burst.retryAfterSec,
        })
      );
    }
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const parsed = parseDecisionRequest(body.body);
    if (!parsed.ok) return respond(parsed);
    // The state and the version are checked before any work is done
    if (run.data.status !== 'review') {
      return respond(
        fail(
          409,
          `Decisions are written only while the run is in review, not in ${run.data.status}`,
          'RUN_STATE'
        )
      );
    }
    const records = await deps.review.listRecords(run.data.id);
    const context = await loadReviewContext(
      deps,
      run.data,
      records.map(r => r.file.relPath)
    );
    return respond(
      await writeDecisions(
        deps,
        run.data,
        session.id,
        parsed.data,
        records,
        context
      )
    );
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
