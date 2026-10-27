import { NextRequest, NextResponse } from 'next/server';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { contentUploadDisabledResponse } from '@/lib/content-upload/staging/guard';
import { reviewDeps } from '@/lib/content-upload/review/context';
import { runOverview } from '@/lib/content-upload/review/service';
import { uploadErrorResponse } from '@/lib/content-upload/staging/route-support';

/**
 * GET /api/trainer/content-upload/overview
 * The runs of the caller (a SUPER_ADMIN sees all), newest first, with the number
 * of files and of decisions and the name of the person who created them. The list
 * of runs in the review pages.
 */
export async function GET(request: NextRequest) {
  const session = await requireCurriculumEditor(request);
  if (isErrorResponse(session)) return session;
  const off = contentUploadDisabledResponse();
  if (off) return off;
  try {
    const runs = await runOverview(reviewDeps(), session);
    return NextResponse.json({ runs });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
