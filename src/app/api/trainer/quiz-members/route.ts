import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { profiles, quizMembers, quizzes } from '@/db/migrations/schemas/schema';
import { isCatalogAllowed, requireCatalogScope } from '@/lib/catalog/scope';
import {
  requireTrainer,
  isErrorResponse,
  scopeOrg,
  isInOrgScope,
  type SessionUser,
} from '@/lib/auth/session';

const TRAINER_LEVEL = ['TRAINER', 'TEMP_ADMIN', 'ADMIN'];

/**
 * The caller may manage the members of a quiz when they created it, are a
 * member themselves, or are an admin of the creator's organization.
 */
async function canManageQuiz(session: SessionUser, quizId: string) {
  const [quiz] = await db
    .select({
      createdById: quizzes.createdById,
      trainingCatalogId: quizzes.trainingCatalogId,
    })
    .from(quizzes)
    .where(eq(quizzes.id, quizId as any))
    .limit(1);
  if (!quiz)
    return { ok: false as const, status: 404, error: 'Quiz not found' };

  // The quiz must lie inside the caller's catalogs (same answer as not found)
  const catalogScope = await requireCatalogScope(session);
  if (catalogScope instanceof Response) {
    return { ok: false as const, status: catalogScope.status, error: 'Forbidden' };
  }
  if (!isCatalogAllowed(catalogScope, quiz.trainingCatalogId)) {
    return { ok: false as const, status: 404, error: 'Quiz not found' };
  }

  if (session.isSuperAdmin || String(quiz.createdById) === session.id) {
    return { ok: true as const };
  }
  const [membership] = await db
    .select({ id: quizMembers.id })
    .from(quizMembers)
    .where(
      and(
        eq(quizMembers.quizId, quizId as any),
        eq(quizMembers.trainerId, session.id as any)
      )
    )
    .limit(1);
  if (membership) return { ok: true as const };

  if (session.isAdmin) {
    const [creator] = await db
      .select({ organizationId: profiles.organizationId })
      .from(profiles)
      .where(eq(profiles.id, quiz.createdById as any))
      .limit(1);
    if (creator && isInOrgScope(scopeOrg(session), creator.organizationId)) {
      return { ok: true as const };
    }
  }
  return { ok: false as const, status: 403, error: 'Forbidden' };
}

// POST: add trainer as member to a quiz
// Body: { quiz_id, trainer_id } where trainer_id is the trainer to add.
// The person adding is always the authenticated user.
export async function POST(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const body = await req.json();
    const quizId = String(body?.quiz_id || body?.quizId || '');
    const trainerId = String(body?.trainer_id || body?.trainerId || '');
    const addedById = session.id;
    if (!quizId)
      return NextResponse.json({ error: 'quiz_id required' }, { status: 400 });
    if (!trainerId)
      return NextResponse.json(
        { error: 'trainer_id required' },
        { status: 400 }
      );

    const access = await canManageQuiz(session, quizId);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      );
    }

    // The new member has to be a trainer-level user of the caller's scope
    const [target] = await db
      .select({ role: profiles.role, organizationId: profiles.organizationId })
      .from(profiles)
      .where(eq(profiles.id, trainerId as any))
      .limit(1);
    if (
      !target ||
      !TRAINER_LEVEL.includes(String(target.role)) ||
      !isInOrgScope(scopeOrg(session), target.organizationId)
    ) {
      return NextResponse.json({ error: 'Trainer not found' }, { status: 404 });
    }

    await db
      .insert(quizMembers)
      .values({ quizId, trainerId, addedById })
      .onConflictDoNothing();
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    console.error('Add quiz member error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// GET: list members of a quiz, or without quizId the quizzes where the
// authenticated trainer is a member
export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { searchParams } = new URL(req.url);
    const quizId = searchParams.get('quizId');

    if (quizId) {
      const access = await canManageQuiz(session, quizId);
      if (!access.ok) {
        return NextResponse.json(
          { error: access.error },
          { status: access.status }
        );
      }
      const rows = await db
        .select({
          id: quizMembers.id,
          trainerId: quizMembers.trainerId,
          addedById: quizMembers.addedById,
          createdAt: quizMembers.createdAt,
        })
        .from(quizMembers)
        .where(eq(quizMembers.quizId, quizId as any));
      return NextResponse.json({ members: rows });
    }

    const rows = await db
      .select({ quizId: quizMembers.quizId })
      .from(quizMembers)
      .where(eq(quizMembers.trainerId, session.id as any));
    return NextResponse.json({ quiz_ids: rows.map(r => String(r.quizId)) });
  } catch (e) {
    console.error('List quiz members error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// DELETE: remove a trainer from a quiz membership
// Body: { quiz_id, trainer_id } where trainer_id is the trainer to remove.
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const body = await req.json().catch(() => ({}));
    const { searchParams } = new URL(req.url);
    const quizId = (body.quiz_id ||
      body.quizId ||
      searchParams.get('quizId')) as string | null;
    const trainerId = (body.trainer_id ||
      body.trainerId ||
      session.id) as string;
    if (!quizId) {
      return NextResponse.json({ error: 'quizId required' }, { status: 400 });
    }

    // Leaving a quiz is always allowed, removing others needs management rights
    if (trainerId !== session.id) {
      const access = await canManageQuiz(session, quizId);
      if (!access.ok) {
        return NextResponse.json(
          { error: access.error },
          { status: access.status }
        );
      }
    }
    await db
      .delete(quizMembers)
      .where(
        and(
          eq(quizMembers.quizId, quizId as any),
          eq(quizMembers.trainerId, trainerId as any)
        )
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete quiz member error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
