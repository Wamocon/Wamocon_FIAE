import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import db from '@/db';
import { courseMembers, enablers } from '@/db/migrations/schemas/schema';
import { isErrorResponse } from '@/lib/auth/session';
import { requireTraineeSession } from '@/lib/auth/activity-report-access';
import { requireContentScopeForUser } from '@/lib/catalog/scope';
import { isTraineeFileReference } from '@/lib/storage/contentPath';
import {
  notFoundResponse,
  traineePdfResponse,
} from '@/lib/storage/traineeFile';
import { isUuid } from '@/lib/uuid';

// GET /api/trainee/enablers/[enablerId]/scenario/content: the bytes of the
// single scenario PDF that an enabler carries itself (enablers.scenario_pdf_url,
// the older form without a row in content_documents). It has no document id, so
// the enabler is the identifier, and the file is the one of its row.
//
// Access: the rule of the enabler page (GET /api/trainee/enablers/[id]): the
// enabler lies in the occupation of the trainee, is active, and the trainee is a
// member of its course. Anything else is 404 (the course membership too, so the
// route does not tell which enablers exist). The material of a locked enabler
// stays readable, like on the page.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  const session = await requireTraineeSession(req);
  if (isErrorResponse(session)) return session;

  try {
    const { enablerId } = await params;
    if (!isUuid(enablerId)) return notFoundResponse();

    const scope = await requireContentScopeForUser(
      session.id,
      req,
      'enabler',
      enablerId
    );
    if (scope instanceof Response) return scope;

    const [enabler] = await db
      .select({
        courseId: enablers.courseId,
        isActive: enablers.isActive,
        scenarioPdfUrl: enablers.scenarioPdfUrl,
      })
      .from(enablers)
      .where(eq(enablers.id, enablerId as any))
      .limit(1);
    if (
      !enabler ||
      !enabler.isActive ||
      typeof enabler.scenarioPdfUrl !== 'string' ||
      enabler.scenarioPdfUrl.trim() === '' ||
      !isTraineeFileReference(enabler.scenarioPdfUrl)
    ) {
      return notFoundResponse();
    }

    const [member] = await db
      .select({ userId: courseMembers.userId })
      .from(courseMembers)
      .where(
        and(
          eq(courseMembers.courseId, enabler.courseId as any),
          eq(courseMembers.userId, session.id as any)
        )
      )
      .limit(1);
    if (!member) return notFoundResponse();

    return await traineePdfResponse(enabler.scenarioPdfUrl);
  } catch (e) {
    console.error('Trainee enabler scenario content GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
