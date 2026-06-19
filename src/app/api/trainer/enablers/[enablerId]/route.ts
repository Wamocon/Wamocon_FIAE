import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import {
  enablers,
  courseMembers,
  courses,
  notifications,
} from '@/db/migrations/schemas/schema';
import { verifyTrainer, getUserOrgId, verifyPlatformOwner } from '@/lib/auth-helpers';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  try {
    const { enablerId } = await params;
    const [row] = await db
      .select()
      .from(enablers)
      .where(eq(enablers.id, enablerId as any));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ enabler: row });
  } catch (e) {
    console.error('Get enabler error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  try {
    const { enablerId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    // Verify enabler exists
    const [row0] = await db
      .select({
        id: enablers.id,
        isActive: enablers.isActive,
        activatedAt: enablers.activatedAt,
        courseId: enablers.courseId,
        title: enablers.title,
      })
      .from(enablers)
      .where(eq(enablers.id, enablerId as any));
    if (!row0) {
      return NextResponse.json({ error: 'Enabler not found' }, { status: 404 });
    }

    // Shared curriculum: any valid trainer can edit any enabler
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    if (!(await verifyPlatformOwner(trainerId))) {
      return NextResponse.json(
        { error: 'Only platform administrators can manage curriculum content' },
        { status: 403 }
      );
    }

    const organizationId = await getUserOrgId(trainerId);

    const body = await req.json();
    const updates: any = {};
    for (const key of [
      'title',
      'orderIndex',
      'durationValue',
      'durationUnit',
      'descriptionText',
      'pptUrl',
      'videoUrl',
      'scenarioPdfUrl',
      'isActive',
    ]) {
      if (typeof body?.[key] !== 'undefined') updates[key] = body[key];
    }

    if (
      typeof body?.isActive === 'boolean' &&
      body.isActive &&
      !row0.isActive &&
      !row0.activatedAt
    ) {
      updates.activatedAt = new Date();
    }

    const [row] = await db
      .update(enablers)
      .set(updates)
      .where(eq(enablers.id, enablerId as any))
      .returning();

    // If activated now, notify trainees in the course
    try {
      if (updates.activatedAt) {
        const traineeMemberRows = await db
          .select({ userId: courseMembers.userId })
          .from(courseMembers)
          .where(
            and(
              eq(courseMembers.courseId, row0.courseId as any),
              eq(courseMembers.role, 'TRAINEE' as any)
            )
          );
        if (traineeMemberRows.length) {
          const values = traineeMemberRows.map(m => ({
            userId: String(m.userId),
            actorId: trainerId,
            type: 'ENABLER_ACTIVATED',
            title: 'Neuer Enabler aktiviert',
            message: `Ein Enabler wurde aktiviert: ${row0.title}`,
            linkUrl: '/trainee/modules',
            context: { enablerId, courseId: row0.courseId },
            organizationId,
          }));
          await db.insert(notifications).values(values);
        }
      }
    } catch (notifyErr) {
      console.warn(
        'Failed to notify trainees for enabler activation',
        notifyErr
      );
    }

    return NextResponse.json({ enabler: row });
  } catch (e) {
    console.error('Update enabler error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  try {
    const { enablerId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    // Verify enabler exists
    const [row0] = await db
      .select({ id: enablers.id })
      .from(enablers)
      .where(eq(enablers.id, enablerId as any));
    if (!row0) {
      return NextResponse.json({ error: 'Enabler not found' }, { status: 404 });
    }

    // Shared curriculum: any valid trainer can delete any enabler
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    if (!(await verifyPlatformOwner(trainerId))) {
      return NextResponse.json(
        { error: 'Only platform administrators can manage curriculum content' },
        { status: 403 }
      );
    }

    await db.delete(enablers).where(eq(enablers.id, enablerId as any));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete enabler error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
