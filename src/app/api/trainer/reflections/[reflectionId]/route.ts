import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { reflections, notifications } from '@/db/migrations/schemas/schema';

// PATCH /api/trainer/reflections/[reflectionId]
// Body: { is_reviewed: boolean, reviewer_id?: string }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ reflectionId: string }> }) {
  try {
    const { reflectionId } = await ctx.params;
    if (!reflectionId) return NextResponse.json({ error: 'Missing reflectionId' }, { status: 400 });
    const body = await req.json();
    const is_reviewed = Boolean(body?.is_reviewed);
    const reviewer_id = body?.reviewer_id as string | undefined;

    const updates: any = { isReviewed: is_reviewed };
    if (reviewer_id) updates.reviewedById = reviewer_id as any;
    const [updated] = await db.update(reflections).set(updates).where(eq(reflections.id, reflectionId as any)).returning();

    // Notify trainee that reflection was reviewed
    try {
      if (updated?.traineeId) {
        await db.insert(notifications).values({
          userId: String(updated.traineeId),
          actorId: reviewer_id || null,
          type: 'REFLECTION_REVIEWED',
          title: 'Reflexion bewertet',
          message: 'Deine Reflexion wurde bewertet',
          linkUrl: '/trainee/reflection',
          context: { reflectionId },
        });
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainee for reflection review', notifyErr);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Trainer reflection PATCH error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
