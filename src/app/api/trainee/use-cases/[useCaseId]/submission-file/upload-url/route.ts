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
import { announceUpload } from '@/lib/submission-file/service';

// POST step 1 of the file of a submission.
// Body: { fileName: string, size: number, contentType?: string }
// The server checks name, size and type, picks the storage path itself and answers with
// the data for uploadToSignedUrl of the storage client. Nothing is stored for a reader
// yet, the file counts only after step 2 (complete).

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
    const { useCaseId } = await params;
    const rate = checkRateLimit(`submission-file:${session.id}`, LIMIT);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
      );
    }

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
    return respond(await announceUpload({ storage }, scope, body), 'upload');
  } catch (error) {
    return storageFailure(error);
  }
}
