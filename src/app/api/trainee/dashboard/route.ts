import { NextRequest, NextResponse } from 'next/server';
import { getNextSubLessonForUser, getUserModuleProgress, getWeeklyProgress, getRecentAchievements, getUpcomingDeadlines } from '@/db/queries';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    const [modules, nextItem, weekly, achievements, deadlines] = await Promise.all([
      getUserModuleProgress(userId),
      getNextSubLessonForUser(userId),
      getWeeklyProgress(userId, 6),
      getRecentAchievements(userId),
      getUpcomingDeadlines(userId),
    ]);

    // Derive a simple radar from top modules by progress (limit 6)
    const radar = modules
      .slice(0, 6)
      .map(m => ({ skill: m.title, value: m.progress }));

  return NextResponse.json({ modules, nextItem, weeklyProgress: weekly, skillRadar: radar, achievements, deadlines });
  } catch (e) {
    console.error('Dashboard API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
