import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { notifications } from '@/db/migrations/schemas/schema';
import { isErrorResponse, requireUser } from '@/lib/auth/session';

// PATCH /api/notifications/{id}
// Body: { isRead?: boolean }
// Only a notification of the session user can be changed. A foreign or missing
// id is answered with 404.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const body = await req.json();
    const isRead = body?.isRead !== undefined ? Boolean(body.isRead) : true;

    const payload: Partial<typeof notifications.$inferInsert> = {
      isRead,
      readAt: isRead ? new Date() : null,
    } as any;

    const [row] = await db
      .update(notifications)
      .set(payload)
      .where(
        and(eq(notifications.id, id), eq(notifications.userId, session.id))
      )
      .returning();

    if (!row) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ notification: row });
  } catch (e) {
    console.error('Notifications PATCH error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
