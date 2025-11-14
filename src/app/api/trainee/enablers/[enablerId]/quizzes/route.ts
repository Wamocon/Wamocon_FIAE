import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  courseMembers,
  enablers,
  enablerQuizLinks,
  options,
  questions,
  quizSubmissions,
  quizzes,
} from '@/db/migrations/schemas/schema';

// GET: list active quizzes for an enabler visible to the trainee with gating
// query: traineeId
export async function GET(req: NextRequest, { params }: { params: { enablerId: string } }) {
  try {
    const { enablerId } = params;
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [enabler] = await db.select().from(enablers).where(eq(enablers.id, enablerId));
    if (!enabler || !enabler.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // membership
    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, enabler.courseId), eq(courseMembers.userId, traineeId)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const links = await db.select().from(enablerQuizLinks).where(eq(enablerQuizLinks.enablerId, enablerId));
    if (links.length === 0) return NextResponse.json({ quizzes: [] });
    const qIds = links.map((l) => l.quizId);
    const qRows = await db.select().from(quizzes).where(inArray(quizzes.id, qIds));
    const active = links
      .map((l) => {
        const q = qRows.find((x) => String(x.id) === String(l.quizId));
        if (!q || !q.isActive) return null;
        return { difficulty: l.difficulty as 'LOW'|'MEDIUM'|'HIGH', quizId: l.quizId, title: q.title || '', isActive: !!q.isActive };
      })
      .filter(Boolean) as Array<{ difficulty: 'LOW'|'MEDIUM'|'HIGH'; quizId: string; title: string; isActive: boolean }>;

    // gating: medium visible if submission exists for low; high visible if submission exists for medium
  const low = active.find((a) => a.difficulty === 'LOW');
  const med = active.find((a) => a.difficulty === 'MEDIUM');
  const high = active.find((a) => a.difficulty === 'HIGH');

    const subs = await db
      .select({ quizId: quizSubmissions.quizId })
      .from(quizSubmissions)
      .where(and(inArray(quizSubmissions.quizId, [low?.quizId, med?.quizId, high?.quizId].filter(Boolean) as string[]), eq(quizSubmissions.traineeId, traineeId)));
    const submitted = new Set(subs.map((s) => String(s.quizId)));

    const visible: Array<{ difficulty: 'LOW'|'MEDIUM'|'HIGH'; quizId: string; title: string; isActive: boolean; unlocked: boolean; completed: boolean }>= [];
    if (low) visible.push({ ...low, unlocked: true, completed: submitted.has(String(low.quizId)) });
    if (med) visible.push({ ...med, unlocked: low ? submitted.has(String(low.quizId)) : false, completed: submitted.has(String(med.quizId)) });
    if (high) visible.push({ ...high, unlocked: med ? submitted.has(String(med.quizId)) : false, completed: submitted.has(String(high.quizId)) });

    return NextResponse.json({ quizzes: visible });
  } catch (e) {
    console.error('List trainee enabler quizzes error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
