import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import { profiles, progress, subLessons } from '@/db/migrations/schemas/schema';

export async function GET(_req: NextRequest, { params }: { params: { traineeId: string } }) {
  try {
    const { traineeId } = params;
    const [p] = await db
      .select({ id: profiles.id, full_name: profiles.full_name, avatar_url: profiles.avatar_url, training_start_date: profiles.training_start_date })
      .from(profiles)
      .where(eq(profiles.id, traineeId as any))
      .limit(1);
    if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [{ totalSubs = 0 } = { totalSubs: 0 }] = await db.select({ totalSubs: count() }).from(subLessons);
    const [{ completed = 0 } = { completed: 0 }] = await db
      .select({ completed: count() })
      .from(progress)
      .where(eq(progress.user_id, traineeId as any));
    const progressPct = totalSubs > 0 ? Math.round((Number(completed) / Number(totalSubs)) * 100) : 0;

    return NextResponse.json({
      trainee: {
        id: p.id,
        full_name: p.full_name,
        avatar_url: p.avatar_url,
        training_start_date: p.training_start_date,
        progress: progressPct,
      },
    });
  } catch (e) {
    console.error('Get trainee detail error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
