import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import { profiles, enablers, courses, enablerCompletions } from '@/db/migrations/schemas/schema';

export async function GET(_req: NextRequest, { params }: { params: { traineeId: string } }) {
  try {
    const { traineeId } = params;
    const [p] = await db
      .select({ id: profiles.id, fullName: profiles.fullName, avatarUrl: profiles.avatarUrl, startOfTrainingDate: profiles.startOfTrainingDate })
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
        const enablerIds = trainerEnablerRows.map((e) => e.id);
        totalEnablers = enablerIds.length;
        if (totalEnablers > 0) {
          const [{ c = 0 } = { c: 0 }] = await db
            .select({ c: count() })
            .from(enablerCompletions)
            .where(and(eq(enablerCompletions.traineeId, traineeId as any), inArray(enablerCompletions.enablerId, enablerIds as any)));
          completed = Number(c);
        }
      }
    }
    const progressPct = totalEnablers > 0 ? Math.round((completed / totalEnablers) * 100) : 0;

    return NextResponse.json({
      trainee: {
        id: p.id,
        full_name: p.fullName,
        avatar_url: p.avatarUrl,
        training_start_date: p.startOfTrainingDate,
        progress: progressPct,
      },
    });
  } catch (e) {
    console.error('Get trainee detail error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { traineeId: string } }) {
  try {
    const { traineeId } = params;
    const body = await req.json();
    const trainer_id = (body?.trainer_id || body?.trainerId) as string | undefined;
    if (!trainer_id) return NextResponse.json({ error: 'trainer_id required' }, { status: 400 });

    // Validate trainer
    const [trainer] = await db
      .select({ id: profiles.id, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, trainer_id as any))
      .limit(1);
    if (!trainer || trainer.role !== 'TRAINER') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Load trainee and ensure assignment to this trainer (if assigned)
    const [trainee] = await db
      .select({ id: profiles.id, assignedTrainerId: profiles.assignedTrainerId })
      .from(profiles)
      .where(eq(profiles.id, traineeId as any))
      .limit(1);
    if (!trainee) return NextResponse.json({ error: 'Trainee not found' }, { status: 404 });
    if (trainee.assignedTrainerId && trainee.assignedTrainerId !== trainer_id) {
      return NextResponse.json({ error: 'Forbidden: trainee not assigned to this trainer' }, { status: 403 });
    }

    const updates: any = {};
    if (typeof body?.full_name === 'string') updates.fullName = body.full_name.trim();
    if (typeof body?.avatar_url === 'string') updates.avatarUrl = body.avatar_url.trim();
    if (body?.start_of_training_date) updates.startOfTrainingDate = new Date(body.start_of_training_date);
    if (typeof body?.assigned_trainer_id === 'string') updates.assignedTrainerId = body.assigned_trainer_id;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const [row] = await db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.id, traineeId as any))
      .returning({ id: profiles.id, fullName: profiles.fullName, avatarUrl: profiles.avatarUrl, startOfTrainingDate: profiles.startOfTrainingDate, assignedTrainerId: profiles.assignedTrainerId });

    return NextResponse.json({
      trainee: {
        id: row.id,
        full_name: row.fullName,
        avatar_url: row.avatarUrl,
        training_start_date: row.startOfTrainingDate,
        assigned_trainer_id: row.assignedTrainerId,
      },
    });
  } catch (e) {
    console.error('Patch trainee detail error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
