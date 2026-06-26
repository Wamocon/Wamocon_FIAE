import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import {
  profiles,
  enablers,
  courses,
  enablerCompletions,
} from '@/db/migrations/schemas/schema';
import { apiCache } from '@/lib/api-cache';
import {
  verifyTrainer,
  getUserOrgId,
  verifyPlatformOwner,
} from '@/lib/auth-helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ traineeId: string }> }
) {
  try {
    const { traineeId } = await params;
    const { searchParams } = new URL(req.url);
    const requesterId =
      searchParams.get('trainerId') || searchParams.get('requesterId');
    if (!requesterId || !(await verifyTrainer(requesterId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const isPO = await verifyPlatformOwner(requesterId);
    if (!isPO) {
      const requesterOrgId = await getUserOrgId(requesterId);
      const traineeOrgId = await getUserOrgId(traineeId);
      if (requesterOrgId !== traineeOrgId) {
        return NextResponse.json(
          { error: 'Trainee not in your organization' },
          { status: 403 }
        );
      }
    }

    const [p] = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        startOfTrainingDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
      })
      .from(profiles)
      .where(eq(profiles.id, traineeId as any))
      .limit(1);
    if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Compute progress: completed enablers / total enablers for courses by this trainee's trainer (if assigned)
    let totalEnablers = 0;
    let completed = 0;
    if (p) {
      // Determine trainer from trainee's assignedTrainerId
      const [traineeProfile] = await db
        .select({ assignedTrainerId: profiles.assignedTrainerId })
        .from(profiles)
        .where(eq(profiles.id, traineeId as any))
        .limit(1);
      const trainerId = traineeProfile?.assignedTrainerId || null;
      if (trainerId) {
        const trainerEnablerRows = await db
          .select({ id: enablers.id })
          .from(enablers)
          .innerJoin(courses, eq(enablers.courseId, courses.id))
          .where(eq(courses.createdById, trainerId as any));
        const enablerIds = trainerEnablerRows.map(e => e.id);
        totalEnablers = enablerIds.length;
        if (totalEnablers > 0) {
          const [{ c = 0 } = { c: 0 }] = await db
            .select({ c: count() })
            .from(enablerCompletions)
            .where(
              and(
                eq(enablerCompletions.traineeId, traineeId as any),
                inArray(enablerCompletions.enablerId, enablerIds as any)
              )
            );
          completed = Number(c);
        }
      }
    }
    const progressPct =
      totalEnablers > 0 ? Math.round((completed / totalEnablers) * 100) : 0;

    return NextResponse.json({
      trainee: {
        id: p.id,
        full_name: p.fullName,
        avatar_url: p.avatarUrl,
        training_start_date: p.startOfTrainingDate,
        ausbildung_duration_years: p.ausbildungDurationYears ?? 3,
        progress: progressPct,
      },
    });
  } catch (e) {
    console.error('Get trainee detail error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ traineeId: string }> }
) {
  try {
    const { traineeId } = await params;
    const body = await req.json();
    const trainer_id = (body?.trainer_id || body?.trainerId) as
      | string
      | undefined;
    if (!trainer_id)
      return NextResponse.json(
        { error: 'trainer_id required' },
        { status: 400 }
      );

    if (!(await verifyTrainer(trainer_id))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const [trainee] = await db
      .select({
        id: profiles.id,
        organizationId: profiles.organizationId,
        assignedTrainerId: profiles.assignedTrainerId,
        isActive: profiles.isActive,
        trainerActivated: profiles.trainerActivated,
      })
      .from(profiles)
      .where(eq(profiles.id, traineeId as any))
      .limit(1);
    if (!trainee)
      return NextResponse.json({ error: 'Trainee not found' }, { status: 404 });

    // Org-scoping: trainer can only manage trainees in their own org (platform owner can manage any)
    const trainerOrgId = await getUserOrgId(trainer_id);
    const isPlatform = await verifyPlatformOwner(trainer_id);
    if (!isPlatform && trainee.organizationId !== trainerOrgId) {
      return NextResponse.json(
        { error: 'You can only manage trainees in your organization' },
        { status: 403 }
      );
    }

    const updates: any = {};
    if (typeof body?.full_name === 'string')
      updates.fullName = body.full_name.trim();
    if (typeof body?.avatar_url === 'string')
      updates.avatarUrl = body.avatar_url.trim();
    if (body?.start_of_training_date)
      updates.startOfTrainingDate = new Date(body.start_of_training_date);
    if (body?.ausbildung_duration_years !== undefined) {
      const duration = Number(body.ausbildung_duration_years);
      if (![2, 3].includes(duration)) {
        return NextResponse.json(
          { error: 'ausbildung_duration_years must be 2 or 3' },
          { status: 400 }
        );
      }
      updates.ausbildungDurationYears = duration;
    }
    if (typeof body?.assigned_trainer_id === 'string')
      updates.assignedTrainerId = body.assigned_trainer_id;
    if (typeof body?.isActive === 'boolean') updates.isActive = body.isActive;
    if (typeof body?.trainer_activated === 'boolean')
      updates.trainerActivated = body.trainer_activated;
    if (body?.isActive === true && !updates.assignedTrainerId) {
      updates.assignedTrainerId = trainer_id;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const [row] = await db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.id, traineeId as any))
      .returning({
        id: profiles.id,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        startOfTrainingDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
        assignedTrainerId: profiles.assignedTrainerId,
        trainerActivated: profiles.trainerActivated,
      });

    apiCache.invalidate('trainer_trainees');
    apiCache.invalidate('trainee_dashboard');
    apiCache.invalidate('activity_reports');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({
      trainee: {
        id: row.id,
        full_name: row.fullName,
        avatar_url: row.avatarUrl,
        training_start_date: row.startOfTrainingDate,
        ausbildung_duration_years: row.ausbildungDurationYears ?? 3,
        assigned_trainer_id: row.assignedTrainerId,
        trainer_activated: row.trainerActivated,
      },
    });
  } catch (e) {
    console.error('Patch trainee detail error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
