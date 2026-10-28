import {
  requireTrainer,
  requireCurriculumEditor,
  isErrorResponse,
} from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import { getUserOrgId } from '@/lib/auth-helpers';
import { apiCache } from '@/lib/api-cache';
import { requireContentScope } from '@/lib/catalog/scope';
import { isTrainerLevelRole } from '@/lib/auth/roles';
import {
  courses,
  courseMembers,
  courseSkills,
  enablers,
  profiles,
  skills,
  notifications,
} from '@/db/migrations/schemas/schema';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const session = await requireTrainer(_req);
    if (isErrorResponse(session)) return session;

    const { courseId } = await params;
    const scope = await requireContentScope(session, _req, 'course', courseId);
    if (isErrorResponse(scope)) return scope;
    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, courseId as any));
    if (!course)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const attachedSkills = await db
      .select({ id: skills.id, name: skills.name })
      .from(courseSkills)
      .leftJoin(skills, eq(courseSkills.skillId, skills.id))
      .where(eq(courseSkills.courseId, courseId as any));

    const ens = await db
      .select({
        id: enablers.id,
        title: enablers.title,
        orderIndex: enablers.orderIndex,
        isActive: enablers.isActive,
        durationValue: enablers.durationValue,
        durationUnit: enablers.durationUnit,
        pptUrl: enablers.pptUrl,
        videoUrl: enablers.videoUrl,
      })
      .from(enablers)
      .where(eq(enablers.courseId, courseId as any))
      .orderBy(enablers.orderIndex);

    const { useCases } = await import('@/db/migrations/schemas/schema');

    const ucs = await db
      .select({
        id: useCases.id,
        title: useCases.title,
        orderIndex: useCases.orderIndex,
        isActive: useCases.isActive,
        durationValue: useCases.durationValue,
        durationUnit: useCases.durationUnit,
        descriptionText: useCases.descriptionText,
      })
      .from(useCases)
      .where(eq(useCases.courseId, courseId as any))
      .orderBy(useCases.orderIndex);

    return NextResponse.json({
      course,
      skills: attachedSkills.map(s => s.name),
      enablers: ens,
      useCases: ucs,
    });
  } catch (e) {
    console.error('Get course error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;

    const { courseId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = session.id;

    // The course must exist and lie inside the caller's catalogs
    const scope = await requireContentScope(session, req, 'course', courseId);
    if (isErrorResponse(scope)) return scope;

    // Verify course exists
    const [courseRow] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, courseId as any));
    if (!courseRow) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Curriculum writes are limited to the platform wide admin
    console.log('[PATCH /course] Checking trainer:', trainerId);

    const organizationId = await getUserOrgId(trainerId);

    const body = await req.json();
    const updates: any = {};
    if (typeof body?.title === 'string') updates.title = body.title;
    if (typeof body?.description === 'string')
      updates.description = body.description;
    if (typeof body?.year !== 'undefined')
      updates.year = body.year === null ? null : Number(body.year);
    if (typeof body?.chapter !== 'undefined')
      updates.chapter = Number(body.chapter);
    if (typeof body?.examPart !== 'undefined')
      updates.examPart = body.examPart === null ? null : Number(body.examPart);
    if (Array.isArray(body?.lernfelder)) updates.lernfelder = body.lernfelder;
    // Visibility columns of the course (platform admin only, like every
    // curriculum write). Nothing else in the app could set them before.
    if (typeof body?.isActive === 'boolean') updates.isActive = body.isActive;
    if (typeof body?.isPublished === 'boolean')
      updates.isPublished = body.isPublished;
    const skillsArr: string[] | undefined = Array.isArray(body?.skills)
      ? body.skills
      : undefined;

    const out = await db.transaction(async tx => {
      if (Object.keys(updates).length) {
        await tx
          .update(courses)
          .set(updates)
          .where(eq(courses.id, courseId as any));
      }

      if (skillsArr) {
        // Reset skills to match provided list
        await tx
          .delete(courseSkills)
          .where(eq(courseSkills.courseId, courseId as any));
        if (skillsArr.length) {
          const existing = await tx
            .select()
            .from(skills)
            .where(inArray(skills.name, skillsArr));
          const existingNames = new Set(existing.map(s => s.name));
          const toInsert = skillsArr
            .filter(n => !existingNames.has(n))
            .map(name => ({ name }));
          if (toInsert.length) await tx.insert(skills).values(toInsert);
          const allSkills = await tx
            .select()
            .from(skills)
            .where(inArray(skills.name, skillsArr));
          if (allSkills.length) {
            await tx.insert(courseSkills).values(
              allSkills.map(s => ({
                courseId: courseId as any,
                skillId: s.id,
              }))
            );
          }
        }
      }

      const [row] = await tx
        .select()
        .from(courses)
        .where(eq(courses.id, courseId as any));
      return row;
    });

    // Notify course members about the update
    try {
      const memberRows = await db
        .select({ userId: courseMembers.userId })
        .from(courseMembers)
        .where(eq(courseMembers.courseId, courseId as any));
      const membersToNotify = memberRows.filter(
        m => String(m.userId) !== trainerId
      );
      if (membersToNotify.length > 0) {
        const courseTitle = out?.title || 'Kurs';
        const notifValues = membersToNotify.map(m => ({
          userId: String(m.userId),
          actorId: trainerId,
          type: 'COURSE_UPDATED',
          title: 'Kurs aktualisiert',
          message: `Der Kurs "${courseTitle}" wurde aktualisiert.`,
          linkUrl: '/trainee/modules',
          context: { courseId },
          organizationId,
        }));
        await db.insert(notifications).values(notifValues);
      }
    } catch (notifyErr) {
      console.warn('Failed to notify members for course update', notifyErr);
    }

    // Invalidate course cache so filters show updated data
    apiCache.invalidate('trainer_courses');

    return NextResponse.json({ course: out });
  } catch (e) {
    console.error('Update course error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;

    const { courseId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = session.id;

    // The course must exist and lie inside the caller's catalogs
    const scope = await requireContentScope(session, req, 'course', courseId);
    if (isErrorResponse(scope)) return scope;

    // Verify course exists
    const [courseRow] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, courseId as any));
    if (!courseRow) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Curriculum writes are limited to the platform wide admin

    const organizationId = await getUserOrgId(trainerId);

    // Gather course members before deletion to notify them
    const memberRows = await db
      .select({ userId: courseMembers.userId, role: courseMembers.role })
      .from(courseMembers)
      .where(eq(courseMembers.courseId, courseId as any));
    const courseName = courseRow.title || 'Kurs';

    // Import trainee_achieved_skills for cascade delete
    const { traineeAchievedSkills } =
      await import('@/db/migrations/schemas/schema');

    // Delete in a transaction to ensure consistency
    await db.transaction(async tx => {
      // First, delete related trainee_achieved_skills that reference this course
      await tx
        .delete(traineeAchievedSkills)
        .where(eq(traineeAchievedSkills.achievedViaCourseId, courseId as any));

      // Now delete the course (other FKs like courseMembers, courseSkills, enablers have ON DELETE CASCADE)
      await tx.delete(courses).where(eq(courses.id, courseId as any));
    });

    // Notify all course members (except the trainer who deleted it)
    try {
      const membersToNotify = memberRows.filter(
        m => String(m.userId) !== trainerId
      );
      if (membersToNotify.length > 0) {
        const notifValues = membersToNotify.map(m => ({
          userId: String(m.userId),
          actorId: trainerId,
          type: 'COURSE_DELETED',
          title: 'Kurs gelöscht',
          message: `Der Kurs "${courseName}" wurde gelöscht.`,
          linkUrl: isTrainerLevelRole(m.role)
            ? '/trainer/courses'
            : '/trainee/modules',
          context: { courseId },
          organizationId,
        }));
        await db.insert(notifications).values(notifValues);
      }
    } catch (notifyErr) {
      console.warn('Failed to notify members for course deletion', notifyErr);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete course error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
