import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import { quizMembers } from '@/db/migrations/schemas/schema';

// POST: add trainer as member to a quiz
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const quizId = String(body?.quiz_id || body?.quizId || '');
    const trainerId = String(body?.trainer_id || body?.trainerId || '');
    const addedById = String(body?.added_by_id || body?.addedById || trainerId || '');
    if (!quizId) return NextResponse.json({ error: 'quiz_id required' }, { status: 400 });
    if (!trainerId) return NextResponse.json({ error: 'trainer_id required' }, { status: 400 });

    await db.insert(quizMembers).values({ quizId, trainerId, addedById }).onConflictDoNothing();
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    console.error('Add quiz member error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// GET: list members of a quiz or quizzes where a trainer is a member
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const quizId = searchParams.get('quizId');
    const trainerId = searchParams.get('trainerId');
    if (!quizId && !trainerId) {
      return NextResponse.json({ error: 'quizId or trainerId required' }, { status: 400 });
    }

    if (quizId) {
      const rows = await db
        .select({ id: quizMembers.id, trainerId: quizMembers.trainerId, addedById: quizMembers.addedById, createdAt: quizMembers.createdAt })
        .from(quizMembers)
        .where(eq(quizMembers.quizId, quizId as any));
      return NextResponse.json({ members: rows });
    } else {
      const rows = await db
        .select({ quizId: quizMembers.quizId })
        .from(quizMembers)
        .where(eq(quizMembers.trainerId, trainerId as any));
      return NextResponse.json({ quiz_ids: rows.map(r => String(r.quizId)) });
    }
  } catch (e) {
    console.error('List quiz members error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: remove a trainer from a quiz membership
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { searchParams } = new URL(req.url);
    const quizId = (body.quiz_id || body.quizId || searchParams.get('quizId')) as string | null;
    const trainerId = (body.trainer_id || body.trainerId || searchParams.get('trainerId')) as string | null;
    if (!quizId || !trainerId) {
      return NextResponse.json({ error: 'quizId and trainerId required' }, { status: 400 });
    }
    await db.delete(quizMembers).where(and(eq(quizMembers.quizId, quizId as any), eq(quizMembers.trainerId, trainerId as any)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete quiz member error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
