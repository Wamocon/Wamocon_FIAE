import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { reflections } from '@/db/migrations/schemas/schema';

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
    await db.update(reflections).set(updates).where(eq(reflections.id, reflectionId as any));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Trainer reflection PATCH error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
