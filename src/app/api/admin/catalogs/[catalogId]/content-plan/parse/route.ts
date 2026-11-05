import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { isUuid } from '@/lib/catalog/admin';
import {
  PLAN_FILE_MAX_BYTES,
  parsePlanDocument,
} from '@/lib/catalog/content-plan/parse-document';
import { getContentPlan } from '@/lib/catalog/content-plan/store';
import { safeFileName } from '@/lib/catalog/content-plan/types';
import {
  contentCheckKiAvailable,
  contentCheckKiEnv,
} from '@/lib/catalog/content-check/ki-availability';
import { NextRequest, NextResponse } from 'next/server';

// Several requests to the AI may follow one another
export const maxDuration = 60;

const PRIVATE = { 'Cache-Control': 'no-store' };

const error = (status: number, code: string) =>
  NextResponse.json(
    { error: 'The plan document could not be read', code },
    { status, headers: PRIVATE }
  );

/**
 * Read a plan document into a PROPOSAL. multipart/form-data with one file
 * (docx, xlsx, csv, json or pdf, up to 5 MB) and an optional field ki=true.
 *
 * Structured files (xlsx, csv, json) are read by script after the template.
 * Word and PDF files are read by the AI (Sokrates) only with ki=true, and every
 * field of the answer needs a quote that stands in the text. The answer is a
 * proposal: nothing is saved here (PUT saves the confirmed plan), and the file
 * is neither stored nor logged. Type and size are checked here, on the server.
 * Platform admin only. The catalog id is checked (404).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ catalogId: string }> }
) {
  try {
    const { catalogId } = await params;
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;
    if (!isUuid(catalogId)) return error(404, 'CATALOG_NOT_FOUND');

    // A declared size above the limit is refused before the body is read
    const declared = Number(req.headers.get('content-length'));
    if (
      Number.isFinite(declared) &&
      declared > PLAN_FILE_MAX_BYTES + 64 * 1024
    ) {
      return error(413, 'FILE_TOO_LARGE');
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return error(400, 'NO_FILE');
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') return error(400, 'NO_FILE');
    if (file.size === 0) return error(400, 'EMPTY_FILE');
    if (file.size > PLAN_FILE_MAX_BYTES) return error(413, 'FILE_TOO_LARGE');

    if ((await getContentPlan(catalogId)) === undefined) {
      return error(404, 'CATALOG_NOT_FOUND');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileName = safeFileName(file.name);
    const outcome = await parsePlanDocument(
      { fileName, bytes, useKi: form.get('ki') === 'true' },
      {
        env: contentCheckKiEnv(process.env),
        available: contentCheckKiAvailable(process.env),
      }
    );
    if (!outcome.ok) return error(outcome.status, outcome.code);

    return NextResponse.json(
      {
        catalogId,
        fileName,
        method: outcome.draft.method,
        rows: outcome.draft.rows,
        issues: outcome.draft.issues,
        warnings: outcome.draft.warnings,
        ...(outcome.ki ? { ki: outcome.ki } : {}),
      },
      { headers: PRIVATE }
    );
  } catch (e) {
    // Never the name or the content of the file
    console.error(
      'Admin parse content plan error',
      e instanceof Error ? e.name : 'unknown'
    );
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
