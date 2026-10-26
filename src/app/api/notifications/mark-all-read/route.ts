import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { notifications } from '@/db/migrations/schemas/schema';
import { isErrorResponse, requireUser } from '@/lib/auth/session';

// POST /api/notifications/mark-all-read
// The notifications of the session user are marked as read. A userId in the
// body (sent by older clients) is ignored, the session is the only identity.
export async function POST(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;

  try {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() } as any)
      .where(
        and(
          eq(notifications.userId, session.id),
          eq(notifications.isRead, false)
        )
      );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Mark all notifications read error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
