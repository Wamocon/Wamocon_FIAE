import { NextRequest, NextResponse } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/guard';
import {
  deleteOrphans,
  listOrphans,
  runCleanup,
} from '@/lib/content-upload/cleanup';
import { uploadDeps } from '@/lib/content-upload/context';
import {
  readJsonBody,
  uploadErrorResponse,
} from '@/lib/content-upload/route-support';

// A cleanup of a large bucket takes a while
export const maxDuration = 60;

/**
 * GET /api/trainer/content-upload/cleanup
 * Lists the orphans of the staging bucket: objects without a file row. Only a
 * list, nothing is deleted. No paths in the answer, run and file ids are enough.
 */
export async function GET(request: NextRequest) {
  const session = await requireCurriculumEditor(request);
  if (isErrorResponse(session)) return session;
  const off = contentUploadDisabledResponse();
  if (off) return off;
  try {
    return NextResponse.json(await listOrphans(uploadDeps()));
  } catch (error) {
    return uploadErrorResponse(error);
  }
}

/**
 * POST /api/trainer/content-upload/cleanup
 * { action: 'run' } (default) cleans up: files never reported as done (after 24
 * hours), runs that were never applied and idle for 30 days, objects of discarded
 * runs and the like. Never an applied run, never an orphan.
 * { action: 'delete_orphans' } deletes orphans older than 7 days, only on this
 * explicit call.
 */
export async function POST(request: NextRequest) {
  const session = await requireCurriculumEditor(request);
  if (isErrorResponse(session)) return session;
  const off = contentUploadDisabledResponse();
  if (off) return off;
  try {
    const parsed = await readJsonBody(request);
    const action =
      parsed.ok && parsed.body && typeof parsed.body === 'object'
        ? (parsed.body as { action?: unknown }).action
        : undefined;
    const deps = uploadDeps();
    if (action === 'delete_orphans') {
      return NextResponse.json(await deleteOrphans(deps));
    }
    if (action === undefined || action === 'run') {
      return NextResponse.json(await runCleanup(deps));
    }
    return NextResponse.json(
      {
        error: "action must be 'run' or 'delete_orphans'",
        code: 'BODY_INVALID',
      },
      { status: 400 }
    );
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
