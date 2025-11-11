import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, max } from 'drizzle-orm';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { gesetzesprozesse } = await import('@/db/migrations/schemas/schema');
    const { courseId } = await params;
    const list = await db
      .select({ id: gesetzesprozesse.id, title: gesetzesprozesse.title, orderIndex: gesetzesprozesse.orderIndex, isActive: gesetzesprozesse.isActive })
      .from(gesetzesprozesse)
      .where(eq(gesetzesprozesse.courseId, courseId as any))
      .orderBy(gesetzesprozesse.orderIndex);
    return NextResponse.json({ gesetzesprozesse: list });
  } catch (e) {
    console.error('List gesetzesprozesse error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { courseId: string } }) {
  try {
    const { gesetzesprozesse, courseMembers, courses } = await import('@/db/migrations/schemas/schema');
    const { courseId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });

    const [courseRow] = await db.select().from(courses).where(eq(courses.id, courseId as any));
    if (!courseRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const member = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, courseId as any), eq(courseMembers.userId, trainerId as any), eq(courseMembers.role, 'TRAINER' as any)));
    const isCreator = String(courseRow.createdById) === String(trainerId);
    if (!member.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const title: string | undefined = body?.title;
    if (!title) return NextResponse.json({ error: 'Missing title' }, { status: 400 });
    const orderIndex: number | undefined = body?.orderIndex ? Number(body.orderIndex) : undefined;
    const durationValue: number | undefined = body?.durationValue ? Number(body.durationValue) : undefined;
    const durationUnitVal: 'DAYS' | 'WEEKS' | undefined = body?.durationUnit || (typeof durationValue === 'number' ? 'DAYS' : undefined);
    const descriptionText: string | undefined = body?.descriptionText;
    const isActive: boolean | undefined = typeof body?.isActive === 'boolean' ? body.isActive : undefined;

    let finalOrderIndex = orderIndex;
    if (typeof finalOrderIndex === 'undefined' || Number.isNaN(finalOrderIndex)) {
      const [m] = await db
        .select({ m: max(gesetzesprozesse.orderIndex) })
        .from(gesetzesprozesse)
        .where(eq(gesetzesprozesse.courseId, courseId as any));
      finalOrderIndex = (Number(m?.m ?? 0) || 0) + 1;
    }

    const activatedAt = isActive ? new Date() : null;
    const [inserted] = await db
      .insert(gesetzesprozesse)
      .values({
        courseId: courseId as any,
        title,
        orderIndex: finalOrderIndex as any,
        durationValue: durationValue as any,
        durationUnit: durationUnitVal as any,
        descriptionText: (descriptionText ?? '') as any,
        isActive: isActive as any,
        activatedAt: activatedAt as any,
      })
      .returning();

    return NextResponse.json({ gesetzesprozess: inserted });
  } catch (e) {
    console.error('Create gesetzesprozess error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
