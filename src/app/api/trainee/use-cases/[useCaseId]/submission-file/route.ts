import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import {
  isSubmissionFileEnabled,
  submissionFileDisabledResponse,
} from '@/lib/submission-file/availability';
import {
  openStorage,
  resolveTraineeScope,
  respond,
  storageFailure,
} from '@/lib/submission-file/access';
import { getFile, removeFile } from '@/lib/submission-file/service';

// GET    the file of the own submission (name, size, date). With ?link=1 also a read link
//        that works for two minutes.
// DELETE removes the file, as long as the submission is open for changes.
// The session user is the trainee, a traineeId in the query is ignored.

type Ctx = { params: Promise<{ useCaseId: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  // The page asks first whether the feature is there at all
  if (!isSubmissionFileEnabled()) {
    return NextResponse.json({ enabled: false, file: null });
  }
  try {
    const { useCaseId } = await params;
    const scope = await resolveTraineeScope(session, req, useCaseId, {
      forChange: false,
    });
    if (scope instanceof Response) return scope;
    const storage = openStorage();
    if (storage instanceof Response) return storage;
    const withLink = new URL(req.url).searchParams.get('link') === '1';
    const result = await getFile({ storage }, scope, { withLink });
    if (!result.ok) return respond(result, 'file');
    return NextResponse.json({ enabled: true, file: result.value });
  } catch (error) {
    return storageFailure(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const disabled = submissionFileDisabledResponse();
  if (disabled) return disabled;
  try {
    const { useCaseId } = await params;
    const scope = await resolveTraineeScope(session, req, useCaseId, {
      forChange: true,
    });
    if (scope instanceof Response) return scope;
    const storage = openStorage();
    if (storage instanceof Response) return storage;
    return respond(await removeFile({ storage }, scope), 'removed');
  } catch (error) {
    return storageFailure(error);
  }
}
