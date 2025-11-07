import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { notifications } from '@/db/migrations/schemas/schema';

// PATCH /api/notifications/{id}
// Body: { isRead?: boolean }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
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
      .where(eq(notifications.id, id))
      .returning();

    return NextResponse.json({ notification: row });
  } catch (e) {
    console.error('Notifications PATCH error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
