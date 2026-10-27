import { NextRequest, NextResponse } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { uploadDeps } from '@/lib/content-upload/staging/context';
import {
  respond,
  readJsonBody,
  uploadErrorResponse,
} from '@/lib/content-upload/staging/route-support';
import { createRun, listRuns, runDto } from '@/lib/content-upload/staging/runs';

/**
 * GET /api/trainer/content-upload/runs
 * The upload runs of the caller (a SUPER_ADMIN sees all), newest first.
 */
export async function GET(request: NextRequest) {
  const session = await requireCurriculumEditor(request);
  if (isErrorResponse(session)) return session;
  const off = contentUploadDisabledResponse();
  if (off) return off;
  try {
    const runs = await listRuns(uploadDeps(), session);
    return NextResponse.json({ runs: runs.map(runDto) });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}

/**
 * POST /api/trainer/content-upload/runs
 * Creates a run: { label, declarationAccepted: true, kiEnabled?, catalog? }.
 * The catalog is KFBM in version 1. At most 3 active runs per person.
 */
export async function POST(request: NextRequest) {
  const session = await requireCurriculumEditor(request);
  if (isErrorResponse(session)) return session;
  const off = contentUploadDisabledResponse();
  if (off) return off;
  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const result = await createRun(uploadDeps(), session, parsed.body);
    return result.ok
      ? NextResponse.json({ run: runDto(result.data) }, { status: 201 })
      : respond(result);
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
