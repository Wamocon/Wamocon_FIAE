import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { authorizeDocumentFile } from '@/lib/storage/documentAccess';
import { parseContentReference } from '@/lib/storage/contentPath';
import {
  ON_DEMAND_SIGNED_SECONDS,
  signContentUrl,
} from '@/lib/storage/contentUrl';

// GET /api/documents/[documentId]/file: a fresh address for the file of one
// document, for the person who may see that document.
//
// The links in the lists carry a signed address that works for an hour. A page
// that stays open longer, and a link that is stored (a source of the HAI chat),
// asks this route for a new one when it is clicked. The answer is JSON and not a
// redirect on purpose: the session of the app is a bearer token that the app
// sends with fetch (authFetch), a plain link or a frame cannot send it.
//
// Access: the rules of the document lists (occupation, organization, visibility,
// course membership for a trainee), see lib/storage/documentAccess.ts. Anything
// that is no access is 404, like a document that does not exist. The file is
// named by the row of the database, never by the request.
//
// Answer: { url, expiresIn }. The url is signed for 15 minutes, or it is the
// stored address of a file that does not lie in the bucket content (a link to
// another host), or the stored address when signing is not possible while the
// bucket is public. A private reference is never returned.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;

  try {
    const { documentId } = await params;
    const access = await authorizeDocumentFile(session, req, documentId);
    if (!access.ok) return access.response;

    const reference = parseContentReference(access.storageUrl);
    if (reference.kind === 'invalid') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const url = await signContentUrl(access.storageUrl, {
      expiresIn: ON_DEMAND_SIGNED_SECONDS,
    });
    // Only a web address leaves: a private reference of another bucket (the
    // model solutions) is no business of this route
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(
      { url, expiresIn: ON_DEMAND_SIGNED_SECONDS },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (e) {
    console.error('Document file GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
