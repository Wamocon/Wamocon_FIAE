import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import { profiles, enablers, courses, enablerCompletions } from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerProfileId') || searchParams.get('trainerAuthId');
    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainer id' }, { status: 400 });
    }

    // Trainees assigned to this trainer
    const traineeRows = await db
      .select({ id: profiles.id, fullName: profiles.fullName, avatarUrl: profiles.avatarUrl })
      .from(profiles)
      .where(and(eq(profiles.role, 'TRAINEE' as any), eq(profiles.assignedTrainerId, trainerId as any)));

    const traineeIds = traineeRows.map(t => t.id);
    // Enablers under this trainer's courses
    const trainerEnablers = await db
      .select({ id: enablers.id })
      .from(enablers)
      .innerJoin(courses, eq(enablers.courseId, courses.id))
      .where(eq(courses.createdById, trainerId as any));
    const enablerIds = trainerEnablers.map(e => e.id);

    // Progress = completed enablers / total enablers
    let totalEnablers = enablerIds.length;
    const completedMap = new Map<string, number>();
    if (totalEnablers > 0 && traineeIds.length > 0) {
      const rows = await db
        .select({ traineeId: enablerCompletions.traineeId, c: count() })
        .from(enablerCompletions)
        .where(and(inArray(enablerCompletions.enablerId, enablerIds as any), inArray(enablerCompletions.traineeId, traineeIds as any)))
        .groupBy(enablerCompletions.traineeId);
      rows.forEach(r => completedMap.set(String(r.traineeId), Number(r.c)));
    }
    const trainees = traineeRows.map(t => {
      const completed = completedMap.get(String(t.id)) || 0;
      const pct = totalEnablers > 0 ? Math.round((completed / totalEnablers) * 100) : 0;
      return { id: t.id, full_name: t.fullName, avatar_url: t.avatarUrl, progress: pct };
    });

    return NextResponse.json({ trainees });
  } catch (e) {
    console.error('List trainer trainees error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
