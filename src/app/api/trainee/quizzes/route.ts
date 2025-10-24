import { NextRequest, NextResponse } from 'next/server';
import { getQuizzesForUser } from '@/db/queries';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    const quizzes = await getQuizzesForUser(userId);
    return NextResponse.json(quizzes);
  } catch (e) {
    console.error('Quizzes API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
