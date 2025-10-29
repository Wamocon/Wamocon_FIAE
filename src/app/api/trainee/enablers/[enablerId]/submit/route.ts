import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { enablers, courseMembers, enablerSubmissions } from '@/db/migrations/schemas/schema';

export async function POST(req: NextRequest, { params }: { params: { enablerId: string } }) {
  try {
    const { enablerId } = params;
    const body = await req.json();
    const traineeId: string | undefined = body?.traineeId;
    const solutionText: string | null = (body?.solutionText ?? null);
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [e] = await db.select().from(enablers).where(eq(enablers.id, enablerId as any));
    if (!e || !e.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, e.courseId as any), eq(courseMembers.userId, traineeId as any)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Upsert-like: if trainee already has a submission, update the latest; else insert
    const existing = await db
      .select()
      .from(enablerSubmissions)
      .where(and(eq(enablerSubmissions.enablerId, enablerId as any), eq(enablerSubmissions.traineeId, traineeId as any)));

    let saved;
    if (existing.length) {
      const latest = existing.sort((a, b) => (new Date(b.submittedAt || '').getTime() - new Date(a.submittedAt || '').getTime()))[0];
      const [row] = await db
        .update(enablerSubmissions)
        .set({ solutionText, status: 'PENDING' as any, submittedAt: new Date() as any })
        .where(eq(enablerSubmissions.id, latest.id as any))
        .returning();
      saved = row;
    } else {
      const [row] = await db
        .insert(enablerSubmissions)
        .values({ enablerId: enablerId as any, traineeId: traineeId as any, solutionText, status: 'PENDING' as any })
        .returning();
      saved = row;
    }

    return NextResponse.json({ submission: { id: saved.id, solutionText: saved.solutionText, status: saved.status } });
  } catch (e) {
    console.error('Trainee enabler submit error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
