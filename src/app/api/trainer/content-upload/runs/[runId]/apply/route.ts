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

// Same budget as the dry run (plan 40 seconds, engines and protocol the rest). Not
// measured on the hosted Preview yet: raise it only after that measurement.
export const maxDuration = 60;

/**
 * POST /api/trainer/content-upload/runs/[runId]/apply
 * Body: { confirm: "KFBM", replaceFiles?: string[], publishOriginals?: string[] }
 *
 * Writes the confirmed files to the content tables in ONE transaction (content and
 * use cases), together with the protocol (the apply, every row it wrote with the
 * values before an update). Everything is inactive. It only starts if the last dry run
 * ended without conflicts for exactly this plan and these switches (409
 * DRY_RUN_REQUIRED otherwise), and only when the person types the catalog code. Only
 * in the Preview and locally, never in Production.
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
    const read = await readJsonBody(request);
    if (!read.ok) return read.response;
    const body = parseTransferBody(read.body);
    if (!body.ok) return respond(body);
    const result = await runTransfer(transferDeps(), {
      runId: run.data.id,
      callerId: session.id,
      mode: 'apply',
      replaceFiles: body.data.replaceFiles,
      publishOriginals: body.data.publishOriginals,
      confirm: body.data.confirm,
    });
    if (!result.ok) return respond(result);
    // Conflicts: nothing was written, the report says what is in the way
    return NextResponse.json(result.data, {
      status: result.data.status === 'conflict' ? 409 : 200,
    });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
