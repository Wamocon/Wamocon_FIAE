import { NextRequest } from 'next/server';
import { isErrorResponse, requireTrainer } from '@/lib/auth/session';
import { submissionFileDisabledResponse } from '@/lib/submission-file/availability';
import {
  openStorage,
  resolveTrainerScope,
  respond,
  storageFailure,
} from '@/lib/submission-file/access';
import { getFile } from '@/lib/submission-file/service';

// GET the file of a use case submission for the trainer who is responsible for the trainee
// (own organization, chosen occupation; admins of the organization are trainer level too).
// Answers { file: null } when the trainee attached none, otherwise name, size, date and a
// read link that works for two minutes (it forces a download, nothing is shown inline).
// With ?link=0 the answer holds name, size and date only (the preview asks for the kind of
// the file first and then reads the bytes from the content route next to this one).

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
    return respond(
      await getFile({ storage }, scope, {
        withLink: new URL(req.url).searchParams.get('link') !== '0',
      }),
      'file'
    );
  } catch (error) {
    return storageFailure(error);
  }
}
