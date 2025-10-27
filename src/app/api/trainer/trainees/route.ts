import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray, or } from 'drizzle-orm';
import { profiles, progress, subLessons } from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let trainerAuthId = searchParams.get('trainerAuthId');
    const trainerProfileId = searchParams.get('trainerProfileId');
    if (!trainerAuthId && trainerProfileId) {
      const row = await db
        .select({ auth_id: profiles.auth_id })
        .from(profiles)
        .where(eq(profiles.id, trainerProfileId as any))
        .limit(1);
      if (row.length > 0) trainerAuthId = String(row[0].auth_id);
    }
    if (!trainerAuthId) {
      return NextResponse.json({ error: 'Missing trainerAuthId' }, { status: 400 });
    }

    const traineeRows = await db
      .select({ id: profiles.id, full_name: profiles.full_name, avatar_url: profiles.avatar_url })
      .from(profiles)
      .where(
        and(
          eq(profiles.role, 'trainee' as any),
          or(
            eq(profiles.trainer_auth_id, trainerAuthId as any),
            trainerProfileId ? eq(profiles.trainer_auth_id, trainerProfileId as any) : eq(profiles.trainer_auth_id, '__never__')
          )
        )
      );

    const traineeIds = traineeRows.map(t => t.id);
    const [{ totalSubs = 0 } = { totalSubs: 0 }] = await db.select({ totalSubs: count() }).from(subLessons);
    const completedByUser = traineeIds.length
      ? await db
          .select({ user_id: progress.user_id, completed: count() })
          .from(progress)
          .where(inArray(progress.user_id, traineeIds as any))
          .groupBy(progress.user_id)
      : [];
    const completedMap = new Map<string, number>(completedByUser.map(r => [String(r.user_id), Number(r.completed)]));
    const trainees = traineeRows.map(t => {
      const completed = completedMap.get(String(t.id)) || 0;
      const pct = totalSubs > 0 ? Math.round((completed / Number(totalSubs)) * 100) : 0;
      return { id: t.id, full_name: t.full_name, avatar_url: t.avatar_url, progress: pct };
    });

    return NextResponse.json({ trainees });
  } catch (e) {
    console.error('List trainer trainees error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
