import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse } from '@/lib/auth/session';
import { requireTraineeSession } from '@/lib/auth/activity-report-access';
import { authorizeDocumentFile } from '@/lib/storage/documentAccess';
import { traineePdfResponse } from '@/lib/storage/traineeFile';

// GET /api/trainee/documents/[documentId]/content: the bytes of the PDF of one
// learning document, for the viewer of a trainee.
//
// The page of a trainee holds no address of the file. The viewer
// (SecurePdfViewer) asks this route with the session of the app (authFetch)
// and draws the pages itself, so the browser's own PDF viewer (with its
// "save as" and print buttons) is never involved.
//
// Access: the rule of the document lists and of the route that signs an address
// (lib/storage/documentAccess.ts): occupation, organization, visibility (ALL,
// TRAINEE_ONLY, unset), no solution, no Word original, active enabler and
// course membership. Anything that is no access answers 404 like a document
// that does not exist. The material of a locked enabler stays readable, like
// the enabler page itself (the writes and the quizzes are closed by their own
// routes).
//
// The file is named by the row of the database. The request carries only the id:
// a path, a bucket or an address in the query changes nothing.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const session = await requireTraineeSession(req);
  if (isErrorResponse(session)) return session;

  try {
    const { documentId } = await params;
    const access = await authorizeDocumentFile(session, req, documentId);
    if (!access.ok) return access.response;
    return await traineePdfResponse(access.storageUrl);
  } catch (e) {
    console.error('Trainee document content GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
