import { NextRequest, NextResponse } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { uploadDeps } from '@/lib/content-upload/staging/context';
import { fail } from '@/lib/content-upload/staging/result';
import {
  respond,
  readJsonBody,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { loadRun } from '@/lib/content-upload/staging/runs';
import { transferDeps } from '@/lib/content-upload/transfer/context';
import { parseTransferBody } from '@/lib/content-upload/transfer/request';
import { runTransfer } from '@/lib/content-upload/transfer/run';
import { checkRateLimit } from '@/lib/rate-limit';

// The plan is built from the files of the run (read from the staging bucket and
// parsed), then the engines run once. The plan may take 40 seconds, the rest a few.
// Not measured on the hosted Preview yet: raise it only after that measurement.
export const maxDuration = 60;

/**
 * POST /api/trainer/content-upload/runs/[runId]/dry-run
 * Body (optional): { updateExisting?: boolean, publishOriginals?: string[] }
 *
 * Runs the whole transfer in a transaction and rolls it back: the counts per table,
 * the conflicts, the files that are skipped and why. Writes nothing to the content.
 * A dry run without conflicts stores the hash of the plan, which is what the apply
 * needs. Only in the Preview and locally, never in Production.
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
    const limit = checkRateLimit(`content-upload-transfer:${session.id}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.allowed) {
      return respond(
        fail(429, 'Too many requests', 'RATE_LIMITED', {
          retryAfterSec: limit.retryAfterSec,
        })
      );
    }
    // The body is optional
    const read = await readJsonBody(request);
    const body = parseTransferBody(read.ok ? read.body : undefined);
    if (!body.ok) return respond(body);
    const result = await runTransfer(transferDeps(), {
      runId: run.data.id,
      callerId: session.id,
      mode: 'dry_run',
      updateExisting: body.data.updateExisting,
      publishOriginals: body.data.publishOriginals,
    });
    return result.ok ? NextResponse.json(result.data) : respond(result);
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
