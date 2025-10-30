import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { courseMembers, profiles, userRole, courses } from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params;
    // Optional: restrict listing to trainer members
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (trainerId) {
      const [courseRow] = await db.select().from(courses).where(eq(courses.id, courseId as any));
      const m = await db
        .select()
        .from(courseMembers)
        .where(and(eq(courseMembers.courseId, courseId as any), eq(courseMembers.userId, trainerId as any), eq(courseMembers.role, 'TRAINER' as any)));
      const isCreator = courseRow ? String(courseRow.createdById) === String(trainerId) : false;
      if (!m.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const list = await db
      .select({ id: courseMembers.id, userId: courseMembers.userId, role: courseMembers.role, fullName: profiles.fullName, email: profiles.email })
      .from(courseMembers)
      .leftJoin(profiles, eq(courseMembers.userId, profiles.id))
      .where(eq(courseMembers.courseId, courseId as any));
    return NextResponse.json({ members: list });
  } catch (e) {
    console.error('List course members error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, courseId as any));
    const m = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, courseId as any), eq(courseMembers.userId, trainerId as any), eq(courseMembers.role, 'TRAINER' as any)));
    const isCreator = courseRow ? String(courseRow.createdById) === String(trainerId) : false;
    if (!m.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const body = await req.json();
    const userId: string | undefined = body?.userId;
    const role: 'TRAINER' | 'TRAINEE' | undefined = body?.role;
    if (!userId || !role) return NextResponse.json({ error: 'Missing userId or role' }, { status: 400 });
    const [row] = await db.insert(courseMembers).values({ courseId: courseId as any, userId, role }).returning();
    return NextResponse.json({ member: row });
  } catch (e) {
    console.error('Add course member error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params;
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const trainerId = searchParams.get('trainerId');
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, courseId as any));
    const m = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, courseId as any), eq(courseMembers.userId, trainerId as any), eq(courseMembers.role, 'TRAINER' as any)));
    const isCreator = courseRow ? String(courseRow.createdById) === String(trainerId) : false;
    if (!m.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await db.delete(courseMembers).where(and(eq(courseMembers.courseId, courseId as any), eq(courseMembers.userId, userId as any)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Remove course member error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
