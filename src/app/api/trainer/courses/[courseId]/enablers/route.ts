import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray, max } from 'drizzle-orm';
import { enablers, durationUnit, courses, courseMembers } from '@/db/migrations/schemas/schema';

export async function GET(_req: NextRequest, { params }: { params: { courseId: string } }) {
  try {
    const { courseId } = params;
    const list = await db
      .select({ id: enablers.id, title: enablers.title, orderIndex: enablers.orderIndex, isActive: enablers.isActive })
      .from(enablers)
      .where(eq(enablers.courseId, courseId as any))
      .orderBy(enablers.orderIndex);
    return NextResponse.json({ enablers: list });
  } catch (e) {
    console.error('List enablers error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { courseId: string } }) {
  try {
    const { courseId } = params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });

    // Trainer permission check: member or creator
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
  const pptUrl: string | undefined = body?.pptUrl;
  const videoUrl: string | undefined = body?.videoUrl;
  const descriptionText: string | undefined = body?.descriptionText;
    const hintText: string | undefined = body?.hintText;
    const scenarioText: string | undefined = body?.scenarioText;
    const scenarioImageUrl: string | undefined = body?.scenarioImageUrl;
    const isActive: boolean | undefined = typeof body?.isActive === 'boolean' ? body.isActive : undefined;

    // Determine next order index if not provided
    let finalOrderIndex = orderIndex;
    if (typeof finalOrderIndex === 'undefined' || Number.isNaN(finalOrderIndex)) {
      const [m] = await db
        .select({ m: max(enablers.orderIndex) })
        .from(enablers)
        .where(eq(enablers.courseId, courseId as any));
      finalOrderIndex = (Number(m?.m ?? 0) || 0) + 1;
    }

    const activatedAt = isActive ? new Date() : null;
    const [inserted] = await db
      .insert(enablers)
      .values({
        courseId: courseId as any,
        title,
        orderIndex: finalOrderIndex as any,
        durationValue: durationValue as any,
        durationUnit: durationUnitVal as any,
  descriptionText: descriptionText as any,
  pptUrl: pptUrl as any,
  videoUrl: videoUrl as any,
        scenarioText: scenarioText as any,
    hintText: hintText as any,
        scenarioImageUrl: scenarioImageUrl as any,
        isActive: isActive as any,
        activatedAt: activatedAt as any,
      })
      .returning();

    return NextResponse.json({ enabler: inserted });
  } catch (e) {
    console.error('Create enabler error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
