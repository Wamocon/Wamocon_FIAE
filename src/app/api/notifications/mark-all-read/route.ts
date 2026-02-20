import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { notifications } from '@/db/migrations/schemas/schema';

// POST /api/notifications/mark-all-read
// Body: { userId: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = body?.userId;
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() } as any)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Mark all notifications read error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
