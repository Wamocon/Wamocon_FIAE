import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { profiles, reflections } from '@/db/migrations/schemas/schema';

// GET /api/trainer/reflections?trainerProfileId=...
// Returns reflections for all trainees assigned to this trainer, newest first, plus summary counts.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerProfileId = searchParams.get('trainerProfileId');
    if (!trainerProfileId) {
      return NextResponse.json({ error: 'Missing trainerProfileId' }, { status: 400 });
    }

    // Find trainees assigned to this trainer
    const traineeRows = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
  .where(and(eq(profiles.role, 'TRAINEE'), eq(profiles.assignedTrainerId, trainerProfileId)));

    if (traineeRows.length === 0) {
      return NextResponse.json({ reflections: [], summary: { total: 0, reviewed: 0, unread: 0 } });
    }
    const traineeIds = traineeRows.map(t => t.id);

    const rows = await db
      .select({
        id: reflections.id,
        traineeId: reflections.traineeId,
        strengths: reflections.strengths,
        weaknesses: reflections.weaknesses,
        mesMore: reflections.mesMore,
        mesEqual: reflections.mesEqual,
        isReviewed: reflections.isReviewed,
        reviewedById: reflections.reviewedById,
        createdAt: reflections.createdAt,
        traineeName: profiles.fullName,
      })
      .from(reflections)
      .innerJoin(profiles, eq(reflections.traineeId, profiles.id))
  .where(inArray(reflections.traineeId, traineeIds))
      .orderBy(desc(reflections.createdAt))
      .limit(200);

    const total = rows.length;
    const reviewed = rows.filter(r => r.isReviewed).length;
    const unread = total - reviewed;
    return NextResponse.json({ reflections: rows, summary: { total, reviewed, unread } });
  } catch (e) {
    console.error('Trainer reflections API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
