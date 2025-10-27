import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { profiles, reflections } from '@/db/migrations/schemas/schema';

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

    if (!trainerAuthId && !trainerProfileId) {
      return NextResponse.json({ error: 'Missing trainerAuthId' }, { status: 400 });
    }

    // Find trainees assigned to this trainer (support both conventions)
    const trainees = await db
      .select({ id: profiles.id, full_name: profiles.full_name })
      .from(profiles)
      .where(
        and(
          eq(profiles.role, 'trainee' as any),
          or(
            trainerAuthId ? eq(profiles.trainer_auth_id, trainerAuthId as any) : eq(profiles.trainer_auth_id, '__none__'),
            trainerProfileId ? eq(profiles.trainer_auth_id, trainerProfileId as any) : eq(profiles.trainer_auth_id, '__none__')
          )
        )
      );

    if (trainees.length === 0) {
      return NextResponse.json({ reflections: [] });
    }
    const traineeIds = trainees.map(t => t.id);

    const rows = await db
      .select({
        id: reflections.id,
        user_id: reflections.user_id,
        due_date: reflections.due_date,
        submitted_at: reflections.submitted_at,
        mes_status: reflections.mes_status,
        trainee_name: profiles.full_name,
      })
      .from(reflections)
      .innerJoin(profiles, eq(reflections.user_id, profiles.id))
      .where(inArray(reflections.user_id, traineeIds as any))
      .orderBy(desc(reflections.submitted_at))
      .limit(50);

    return NextResponse.json({ reflections: rows });
  } catch (e) {
    console.error('Trainer reflections API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
