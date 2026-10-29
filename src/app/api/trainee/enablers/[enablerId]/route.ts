import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { enablers, courseMembers, enablerSubmissions, EnablerSubmission } from '@/db/migrations/schemas/schema';
import { requireContentScopeForUser } from '@/lib/catalog/scope';
import { getEnablerProgression } from '@/lib/catalog/progression-db';
import { withSignedContentFields } from '@/lib/storage/contentUrl';

// GET trainee-facing enabler detail (title, description, ppt, video)
// The data of the session user, a traineeId or userId in the query is ignored.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const traineeId = session.id;

  try {
    const { enablerId } = await params;

    // The content must lie inside the catalog scope of the trainee
    const catalogScope = await requireContentScopeForUser(traineeId, req, 'enabler', enablerId);
    if (catalogScope instanceof Response) return catalogScope;

    const [e] = await db.select().from(enablers).where(eq(enablers.id, enablerId));
    if (!e || !e.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, e.courseId), eq(courseMembers.userId, traineeId)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Latest submission by this trainee for the enabler scenario
    const subs: EnablerSubmission[] = await db
      .select()
      .from(enablerSubmissions)
      .where(and(eq(enablerSubmissions.enablerId, enablerId), eq(enablerSubmissions.traineeId, traineeId)));
    const latest = subs.sort((a, b) => (new Date(b.submittedAt || '').getTime() - new Date(a.submittedAt || '').getTime()))[0];

    // Order of work: the title and the material of a locked enabler stay
    // readable, the answer says that it is locked and what to finish first.
    // The writes and the quiz questions are closed by their own routes.
    const found = await getEnablerProgression(traineeId, {
      id: String(e.id),
      courseId: String(e.courseId),
    });
    const progression = found
      ? {
          state: found.enabler.state,
          locked: found.enabler.locked,
          reason: found.enabler.lockReason,
          lockedBy: found.enabler.lockedBy
            ? {
                id: found.enabler.lockedBy.enablerId,
                title: found.enabler.lockedBy.title,
              }
            : null,
        }
      : { state: 'open', locked: false, reason: null, lockedBy: null };

    // A file of the bucket content (scenario PDF, slides, a video that was
    // uploaded) is handed out as a signed address, a link to another host stays
    const [links] = await withSignedContentFields(
      [
        {
          scenarioPdfUrl: e.scenarioPdfUrl,
          pptUrl: e.pptUrl,
          videoUrl: e.videoUrl,
        },
      ],
      ['scenarioPdfUrl', 'pptUrl', 'videoUrl'],
      { hideOtherPrivate: true }
    );

    return NextResponse.json({
      progression,
      enabler: {
        id: e.id,
        title: e.title,
        descriptionText: e.descriptionText,
        scenarioPdfUrl: links.scenarioPdfUrl,
        pptUrl: links.pptUrl,
        videoUrl: links.videoUrl,
        isActive: e.isActive,
        durationValue: e.durationValue,
        durationUnit: e.durationUnit,
        activatedAt: e.activatedAt,
      },
      submission: latest ? {
        id: latest.id,
        solutionText: latest.solutionText,
        solutions: latest.solutions,
        status: latest.status,
        trainerFeedback: latest.trainerFeedback,
        feedbacks: latest.feedbacks
      } : null,
    });
  } catch (e) {
    console.error('Trainee enabler detail GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
