import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import {
  courseMembers,
  profiles,
  courses,
  notifications,
} from '@/db/migrations/schemas/schema';
import { verifyTrainer } from '@/lib/auth-helpers';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Helper to verify the course exists
 */
async function verifyCourseExists(courseId: string): Promise<boolean> {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.id, courseId as any));
  return !!course;
}

// GET /api/trainer/courses/[courseId]/members
// Returns all members of a course
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
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
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    const list = await db
      .select({
        id: courseMembers.id,
        userId: courseMembers.userId,
        role: courseMembers.role,
        fullName: profiles.fullName,
        email: profiles.email,
      })
      .from(courseMembers)
      .leftJoin(profiles, eq(courseMembers.userId, profiles.id))
      .where(eq(courseMembers.courseId, courseId as any));

    return NextResponse.json({ members: list });
  } catch (e) {
    console.error('List course members error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// POST /api/trainer/courses/[courseId]/members
// Add a member (trainee or trainer) to a course
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
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
    console.log('[POST /members] Checking trainer:', trainerId);
    if (!(await verifyTrainer(trainerId))) {
      console.log(
        '[POST /members] Trainer verification failed for:',
        trainerId
      );
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const userId: string | undefined = body?.userId;
    const role: 'TRAINER' | 'TRAINEE' | undefined = body?.role;

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }
    if (!role || !['TRAINER', 'TRAINEE'].includes(role)) {
      return NextResponse.json(
        { error: 'Missing or invalid role (must be TRAINER or TRAINEE)' },
        { status: 400 }
      );
    }

    // Verify the user to be added exists
    const [userToAdd] = await db
      .select({ id: profiles.id, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId as any));
    if (!userToAdd) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if user is already a member of this course
    // Use ON CONFLICT DO NOTHING to handle race conditions and pooler issues
    let row;
    try {
      const [existingMember] = await db
        .select()
        .from(courseMembers)
        .where(
          and(
            eq(courseMembers.courseId, courseId as any),
            eq(courseMembers.userId, userId as any)
          )
        );

      if (existingMember) {
        return NextResponse.json(
          { error: 'User is already a member of this course' },
          { status: 409 }
        );
      }

      // Insert the new member
      const result = await db
        .insert(courseMembers)
        .values({
          courseId: courseId as any,
          userId,
          role,
        })
        .returning();

      row = result[0];
    } catch (insertErr: unknown) {
      // Handle duplicate key violation (unique constraint on courseId + userId)
      const pgCode = (insertErr as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === '23505') {
        return NextResponse.json(
          { error: 'User is already a member of this course' },
          { status: 409 }
        );
      }
      throw insertErr;
    }

    if (!row) {
      return NextResponse.json(
        { error: 'Failed to add member' },
        { status: 500 }
      );
    }

    // Notify the added user
    try {
      const [courseInfo] = await db
        .select({ title: courses.title })
        .from(courses)
        .where(eq(courses.id, courseId as any));
      const courseName = courseInfo?.title || 'einem Kurs';
      const isTrainer = role === 'TRAINER';

      try {
        await db.insert(notifications).values({
          userId,
          actorId: trainerId,
          type: isTrainer ? 'COURSE_CO_TRAINER_ADDED' : 'COURSE_ASSIGNED',
          title: isTrainer ? 'Als Trainer hinzugefügt' : 'Zu Kurs hinzugefügt',
          message: isTrainer
            ? `Du wurdest als Trainer zu "${courseName}" hinzugefügt`
            : `Du wurdest dem Kurs "${courseName}" zugewiesen`,
          linkUrl: isTrainer
            ? `/trainer/courses/${courseId}`
            : '/trainee/modules',
          context: { courseId },
        });
      } catch (drizzleErr: unknown) {
        const pgCode = (drizzleErr as { cause?: { code?: string } })?.cause
          ?.code;
        if (pgCode === '23503') {
          // FK violation — pooler can't see profiles; fall back to admin client
          const admin = getAdminClient();
          await admin.from('notifications').insert({
            user_id: userId,
            actor_id: trainerId,
            type: isTrainer ? 'COURSE_CO_TRAINER_ADDED' : 'COURSE_ASSIGNED',
            title: isTrainer
              ? 'Als Trainer hinzugefügt'
              : 'Zu Kurs hinzugefügt',
            message: isTrainer
              ? `Du wurdest als Trainer zu "${courseName}" hinzugefügt`
              : `Du wurdest dem Kurs "${courseName}" zugewiesen`,
            link_url: isTrainer
              ? `/trainer/courses/${courseId}`
              : '/trainee/modules',
            context: { courseId },
          });
        } else {
          throw drizzleErr;
        }
      }
    } catch (notifyErr) {
      console.warn('Failed to notify added course member', notifyErr);
    }

    return NextResponse.json({ member: row });
  } catch (e) {
    console.error('Add course member error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// DELETE /api/trainer/courses/[courseId]/members
// Remove a member from a course
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
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
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    // Prevent trainer from removing themselves if they're the only trainer
    const [memberToRemove] = await db
      .select()
      .from(courseMembers)
      .where(
        and(
          eq(courseMembers.courseId, courseId as any),
          eq(courseMembers.userId, userId as any)
        )
      );

    if (!memberToRemove) {
      return NextResponse.json(
        { error: 'Member not found in this course' },
        { status: 404 }
      );
    }

    // Delete the member
    await db
      .delete(courseMembers)
      .where(
        and(
          eq(courseMembers.courseId, courseId as any),
          eq(courseMembers.userId, userId as any)
        )
      );

    // Notify the removed user
    try {
      const [courseInfo] = await db
        .select({ title: courses.title })
        .from(courses)
        .where(eq(courses.id, courseId as any));
      const courseName = courseInfo?.title || 'einem Kurs';
      await db.insert(notifications).values({
        userId,
        actorId: trainerId,
        type: 'COURSE_MEMBER_REMOVED',
        title: 'Aus Kurs entfernt',
        message: `Du wurdest aus dem Kurs "${courseName}" entfernt.`,
        linkUrl:
          memberToRemove.role === 'TRAINER'
            ? '/trainer/courses'
            : '/trainee/modules',
        context: { courseId },
      });
    } catch (notifyErr) {
      console.warn('Failed to notify removed course member', notifyErr);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Remove course member error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
