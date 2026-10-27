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
import { poolQueryable } from '@/lib/content-upload/transfer/context';
import {
  RollbackSqlError,
  rollbackAnswer,
} from '@/lib/content-upload/transfer/rollback';
import { isUuid } from '@/lib/uuid';

export const maxDuration = 60;

/**
 * GET /api/trainer/content-upload/runs/[runId]/rollback-sql[?applyId=<uuid>]
 *
 * Makes the SQL text that takes back one apply (the newest of the run, or the one named)
 * from its protocol. READS only: the app never deletes content. The owner runs the text
 * himself, first as a probe that ends with "rollback", then with "commit". Instead of
 * the text the answer names what stands in the way (a later apply, active content,
 * data of learners). Only in the Preview and locally, never in Production.
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
    const applyId = request.nextUrl.searchParams.get('applyId');
    if (applyId !== null && !isUuid(applyId)) {
      return respond(fail(400, 'applyId must be a uuid', 'APPLY_INVALID'));
    }
    let answer;
    try {
      answer = await rollbackAnswer(poolQueryable(), {
        runId: run.data.id,
        applyId: applyId?.toLowerCase() ?? null,
      });
    } catch (error) {
      if (error instanceof RollbackSqlError) {
        return respond(
          fail(
            409,
            'The protocol of the apply cannot be turned into SQL',
            'PROTOCOL_INVALID'
          )
        );
      }
      throw error;
    }
    if (!answer) {
      return respond(
        fail(404, 'The run has no apply to roll back', 'NO_APPLY')
      );
    }
    return NextResponse.json(answer);
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
