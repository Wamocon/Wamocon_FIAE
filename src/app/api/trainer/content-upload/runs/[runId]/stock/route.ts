import { NextRequest, NextResponse } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { uploadDeps } from '@/lib/content-upload/staging/context';
import { fail } from '@/lib/content-upload/staging/result';
import {
  respond,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { loadRun } from '@/lib/content-upload/staging/runs';
import { compareStock } from '@/lib/content-upload/transfer/compare';
import { transferDeps } from '@/lib/content-upload/transfer/context';
import { checkRateLimit } from '@/lib/rate-limit';

// The files are read from the staging bucket and parsed like for a dry run, the
// engines only read. Same budget as the dry run. Not measured on the hosted Preview.
export const maxDuration = 60;

/**
 * POST /api/trainer/content-upload/runs/[runId]/stock
 *
 * Compares every classified file of the run with the database and stores the
 * status of the supply per file (new, unchanged, extended, differs, conflict) for the
 * review list. A file without a decision is compared with the assignment of its
 * proposal. Writes nothing to the content and changes no decision. Only in the
 * Preview and locally, never in Production.
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
    const result = await compareStock(transferDeps(), {
      runId: run.data.id,
      callerId: session.id,
    });
    return result.ok ? NextResponse.json(result.data) : respond(result);
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
