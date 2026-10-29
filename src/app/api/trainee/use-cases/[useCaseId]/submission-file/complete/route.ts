import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { submissionFileDisabledResponse } from '@/lib/submission-file/availability';
import {
  openStorage,
  resolveTraineeScope,
  respond,
  storageFailure,
} from '@/lib/submission-file/access';
import { completeUpload } from '@/lib/submission-file/service';

// POST step 2 of the file of a submission, after the browser has uploaded the file.
// Body: { uploadId: string, fileName?: string }
// The server reads the object it picked the path for, checks size and bytes and only then
// makes it the file of the submission (the earlier file is removed). A file that fails the
// check is deleted.

const LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ useCaseId: string }> }
) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const disabled = submissionFileDisabledResponse();
  if (disabled) return disabled;
  try {
    const rate = checkRateLimit(
      `submission-file-complete:${session.id}`,
      LIMIT
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
      );
    }
    const { useCaseId } = await params;
    const scope = await resolveTraineeScope(session, req, useCaseId, {
      forChange: true,
    });
    if (scope instanceof Response) return scope;

    let body: Record<string, unknown> | null = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const storage = openStorage();
    if (storage instanceof Response) return storage;
    return respond(await completeUpload({ storage }, scope, body), 'file');
  } catch (error) {
    return storageFailure(error);
  }
}
