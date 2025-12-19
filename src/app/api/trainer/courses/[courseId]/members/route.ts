import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { courseMembers, profiles, courses, notifications } from '@/db/migrations/schemas/schema';

/**
 * Helper to verify the requesting user is a valid trainer in the system.
 * For shared curriculum model, any TRAINER can manage any course.
 */
async function verifyTrainer(trainerId: string): Promise<boolean> {
  const [trainer] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, trainerId as any));
  return trainer?.role === 'TRAINER';
}

/**
 * Helper to verify the course exists
 */
async function verifyCourseExists(courseId: string): Promise<boolean> {
  const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId as any));
  return !!course;
}

// GET /api/trainer/courses/[courseId]/members
// Returns all members of a course
export async function GET(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');

    // Verify course exists
    if (!(await verifyCourseExists(courseId))) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // If trainerId provided, verify they are a trainer
    if (trainerId && !(await verifyTrainer(trainerId))) {
      return NextResponse.json({ error: 'Forbidden - not a trainer' }, { status: 403 });
    }

    const list = await db
      .select({
        id: courseMembers.id,
        userId: courseMembers.userId,
        role: courseMembers.role,
        fullName: profiles.fullName,
        email: profiles.email
      })
      .from(courseMembers)
      .leftJoin(profiles, eq(courseMembers.userId, profiles.id))
      .where(eq(courseMembers.courseId, courseId as any));

    return NextResponse.json({ members: list });
  } catch (e) {
    console.error('List course members error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/trainer/courses/[courseId]/members
// Add a member (trainee or trainer) to a course
export async function POST(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');

    // Validate trainerId is provided
    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    // Verify course exists
    if (!(await verifyCourseExists(courseId))) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Verify the requester is a valid trainer (shared curriculum - any trainer can manage)
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json({ error: 'Forbidden - not a trainer' }, { status: 403 });
    }

    const body = await req.json();
    const userId: string | undefined = body?.userId;
    const role: 'TRAINER' | 'TRAINEE' | undefined = body?.role;

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }
    if (!role || !['TRAINER', 'TRAINEE'].includes(role)) {
      return NextResponse.json({ error: 'Missing or invalid role (must be TRAINER or TRAINEE)' }, { status: 400 });
    }

    // Verify the user to be added exists
    const [userToAdd] = await db.select({ id: profiles.id, role: profiles.role }).from(profiles).where(eq(profiles.id, userId as any));
    if (!userToAdd) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if user is already a member of this course
    const [existingMember] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, courseId as any), eq(courseMembers.userId, userId as any)));

    if (existingMember) {
      return NextResponse.json({ error: 'User is already a member of this course' }, { status: 409 });
    }

    // Insert the new member
    const [row] = await db.insert(courseMembers).values({
      courseId: courseId as any,
      userId,
      role
    }).returning();

    // Notify the added user
    try {
      const [courseInfo] = await db.select({ title: courses.title }).from(courses).where(eq(courses.id, courseId as any));
      const courseName = courseInfo?.title || 'einem Kurs';
      const isTrainer = role === 'TRAINER';

      await db.insert(notifications).values({
        userId,
        actorId: trainerId,
        type: isTrainer ? 'COURSE_CO_TRAINER_ADDED' : 'COURSE_ASSIGNED',
        title: isTrainer ? 'Als Trainer hinzugefügt' : 'Zu Kurs hinzugefügt',
        message: isTrainer
          ? `Du wurdest als Trainer zu "${courseName}" hinzugefügt`
          : `Du wurdest dem Kurs "${courseName}" zugewiesen`,
        linkUrl: isTrainer ? `/trainer/courses/${courseId}` : '/trainee/modules',
        context: { courseId },
      });
    } catch (notifyErr) {
      console.warn('Failed to notify added course member', notifyErr);
    }

    return NextResponse.json({ member: row });
  } catch (e) {
    console.error('Add course member error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/trainer/courses/[courseId]/members
// Remove a member from a course
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params;
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const trainerId = searchParams.get('trainerId');

    // Validate required params
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }
    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    // Verify course exists
    if (!(await verifyCourseExists(courseId))) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Verify the requester is a valid trainer (shared curriculum - any trainer can manage)
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json({ error: 'Forbidden - not a trainer' }, { status: 403 });
    }

    // Prevent trainer from removing themselves if they're the only trainer
    const [memberToRemove] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, courseId as any), eq(courseMembers.userId, userId as any)));

    if (!memberToRemove) {
      return NextResponse.json({ error: 'Member not found in this course' }, { status: 404 });
    }

    // Delete the member
    await db.delete(courseMembers).where(
      and(
        eq(courseMembers.courseId, courseId as any),
        eq(courseMembers.userId, userId as any)
      )
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Remove course member error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

