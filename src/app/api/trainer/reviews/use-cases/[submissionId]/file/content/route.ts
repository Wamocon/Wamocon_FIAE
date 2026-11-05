import { NextRequest } from 'next/server';
import { isErrorResponse, requireTrainer } from '@/lib/auth/session';
import { submissionFileDisabledResponse } from '@/lib/submission-file/availability';
import {
  openStorage,
  resolveTrainerScope,
  respondContent,
  storageFailure,
} from '@/lib/submission-file/access';
import { getFileContent } from '@/lib/submission-file/service';

// GET the bytes of the file of a use case submission, for the preview in the
// review (WMCNL-2927: a PDF in the viewer, an image as an image). The same access
// as the download route next to it: the trainee of the submission has to lie in
// the organization and the chosen occupation of the caller. A Word or Excel file
// answers 415, those are only downloaded.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  const session = await requireTrainer(req);
  if (isErrorResponse(session)) return session;
  const disabled = submissionFileDisabledResponse();
  if (disabled) return disabled;
  try {
    const { submissionId } = await params;
    const scope = await resolveTrainerScope(session, req, submissionId);
    if (scope instanceof Response) return scope;
    const storage = openStorage();
    if (storage instanceof Response) return storage;
    return respondContent(await getFileContent({ storage }, scope));
  } catch (error) {
    return storageFailure(error);
  }
}
