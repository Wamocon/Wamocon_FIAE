import { NextRequest } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { submissionFileDisabledResponse } from '@/lib/submission-file/availability';
import {
  openStorage,
  resolveTraineeScope,
  respondContent,
  storageFailure,
} from '@/lib/submission-file/access';
import { getFileContent } from '@/lib/submission-file/service';

// GET the bytes of the file of the own submission, for the preview after the
// upload (WMCNL-2927: a PDF in the viewer, an image as an image). The same access
// as reading the file info next to it: the session user is the trainee, a
// traineeId in the query does not exist. A Word or Excel file answers 415.

type Ctx = { params: Promise<{ useCaseId: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const disabled = submissionFileDisabledResponse();
  if (disabled) return disabled;
  try {
    const { useCaseId } = await params;
    const scope = await resolveTraineeScope(session, req, useCaseId, {
      forChange: false,
    });
    if (scope instanceof Response) return scope;
    const storage = openStorage();
    if (storage instanceof Response) return storage;
    return respondContent(await getFileContent({ storage }, scope));
  } catch (error) {
    return storageFailure(error);
  }
}
