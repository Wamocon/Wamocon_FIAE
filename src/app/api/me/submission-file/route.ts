import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { isSubmissionFileEnabled } from '@/lib/submission-file/availability';
import {
  MAX_SUBMISSION_FILE_BYTES,
  SUBMISSION_EXTENSIONS,
} from '@/lib/submission-file/rules';

// GET whether the file of a submission is available in this deployment, and its limits.
// The pages use it to show or hide the upload; the routes check the same switch again.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  return NextResponse.json({
    enabled: isSubmissionFileEnabled(),
    maxBytes: MAX_SUBMISSION_FILE_BYTES,
    extensions: SUBMISSION_EXTENSIONS,
  });
}
