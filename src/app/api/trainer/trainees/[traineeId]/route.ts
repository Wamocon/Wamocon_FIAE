import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
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
import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import {
  isTrainerInOrgScope,
  traineeRecordCondition,
} from '@/lib/auth/trainee-scope-conditions';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ traineeId: string }> }
) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { traineeId } = await params;

    // Only a trainee of the own organization (the super admin: any) and of the
    // chosen occupation, everything else is not found.
    const access = await requireTraineeAccess(session, traineeId, req);
    if (isErrorResponse(access)) return access;

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
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { traineeId } = await params;
    const body = await req.json();
    const trainer_id = session.id;

    // Only a trainee of the own organization (the super admin: any) and of the
    // chosen occupation, everything else is not found and stays untouched.
    const access = await requireTraineeAccess(session, traineeId, req);
    if (isErrorResponse(access)) return access;

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
    if (typeof body?.assigned_trainer_id === 'string') {
      // The new trainer has to be a trainer of the same organization scope,
      // otherwise the trainee would become visible to a foreign trainer
      if (!(await isTrainerInOrgScope(session, body.assigned_trainer_id))) {
        return NextResponse.json(
          { error: 'Trainer not found' },
          { status: 404 }
        );
      }
      updates.assignedTrainerId = body.assigned_trainer_id;
    }
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
      .where(traineeRecordCondition(session, access.traineeId))
      .returning({
        id: profiles.id,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        startOfTrainingDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
        assignedTrainerId: profiles.assignedTrainerId,
        trainerActivated: profiles.trainerActivated,
      });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
