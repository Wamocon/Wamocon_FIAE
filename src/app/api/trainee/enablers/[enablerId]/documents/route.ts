import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  contentDocuments,
  courseMembers,
  enablers,
} from '@/db/migrations/schemas/schema';
import { isErrorResponse } from '@/lib/auth/session';
import { requireTraineeSession } from '@/lib/auth/activity-report-access';
import { documentVisibilityCondition } from '@/lib/auth/document-scope';
import { requireContentScopeForUser } from '@/lib/catalog/scope';

// GET the documents of an enabler for the trainee (teaching texts, scenarios).
//
// The trainer route of the same name is closed to a trainee, so the trainee
// page has its own route with its own filter:
//  - the enabler has to lie in the occupation of the trainee, be active, and
//    the trainee has to be a member of its course (like the enabler detail),
//  - a document is meant for trainees: its visibility is ALL, TRAINEE_ONLY or
//    unset, never TRAINER_ONLY, and it is no TRAINER_SOLUTION (the solutions
//    of a use case are trainer material),
//  - it belongs to the shared curriculum, the platform or the own organization
//    (documentVisibilityCondition, the rule of the trainer lists),
//  - it carries a file: a row with an empty storage_url (a scenario kept as a
//    row without a file) is no link and is not listed.
// The answer names the fields the page needs. The uploader, the storage path,
// the index state and the organization ids stay behind. The file itself is
// reached through storageUrl as before, this route does not change that.
// The data of the session user, a traineeId or userId in the query is ignored.
const TRAINEE_VISIBILITIES = ['ALL', 'TRAINEE_ONLY'] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  const session = await requireTraineeSession(req);
  if (isErrorResponse(session)) return session;
  const traineeId = session.id;

  try {
    const { enablerId } = await params;

    // The enabler must lie inside the catalog scope of the trainee
    const catalogScope = await requireContentScopeForUser(
      traineeId,
      req,
      'enabler',
      enablerId
    );
    if (catalogScope instanceof Response) return catalogScope;

    const [enabler] = await db
      .select({
        id: enablers.id,
        isActive: enablers.isActive,
        courseId: enablers.courseId,
      })
      .from(enablers)
      .where(eq(enablers.id, enablerId));
    if (!enabler || !enabler.isActive) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const [member] = await db
      .select({ userId: courseMembers.userId })
      .from(courseMembers)
      .where(
        and(
          eq(courseMembers.courseId, enabler.courseId),
          eq(courseMembers.userId, traineeId)
        )
      );
    if (!member) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rows = await db
      .select({
        id: contentDocuments.id,
        title: contentDocuments.title,
        description: contentDocuments.description,
        documentType: contentDocuments.documentType,
        visibility: contentDocuments.visibility,
        organizationId: contentDocuments.organizationId,
        fileName: contentDocuments.fileName,
        fileSize: contentDocuments.fileSize,
        storageUrl: contentDocuments.storageUrl,
        pageCount: contentDocuments.pageCount,
        orderIndex: contentDocuments.orderIndex,
      })
      .from(contentDocuments)
      .where(
        and(
          eq(contentDocuments.enablerId, enablerId),
          or(
            isNull(contentDocuments.visibility),
            inArray(contentDocuments.visibility, [...TRAINEE_VISIBILITIES])
          ),
          or(
            isNull(contentDocuments.documentType),
            ne(contentDocuments.documentType, 'TRAINER_SOLUTION')
          ),
          sql`btrim(${contentDocuments.storageUrl}) <> ''`,
          // The shared curriculum, the platform and the own organization
          documentVisibilityCondition(contentDocuments.organizationId, session)
        )
      )
      .orderBy(contentDocuments.orderIndex);

    // The query already keeps trainer material and rows without a file away.
    // The same rule once more on the rows, so a change of the query alone can
    // not hand trainer material to a trainee.
    const documents = rows
      .filter(
        d =>
          d.visibility !== 'TRAINER_ONLY' &&
          d.documentType !== 'TRAINER_SOLUTION' &&
          typeof d.storageUrl === 'string' &&
          d.storageUrl.trim() !== ''
      )
      .map(d => ({
        id: d.id,
        title: d.title,
        description: d.description,
        documentType: d.documentType,
        fileName: d.fileName,
        fileSize: d.fileSize,
        storageUrl: d.storageUrl,
        pageCount: d.pageCount,
        orderIndex: d.orderIndex,
        // The page hides the shared teaching texts from the LIGHT plan
        isOwnOrganization:
          !!d.organizationId &&
          String(d.organizationId) === session.organizationId,
      }));

    return NextResponse.json({ documents });
  } catch (e) {
    console.error('Trainee enabler documents GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
