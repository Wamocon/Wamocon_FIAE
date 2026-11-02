import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { profiles } from '@/db/migrations/schemas/schema';
import { cacheHeaders } from '@/lib/api-cache';
import { requireTraineeScopeCondition } from '@/lib/auth/trainee-scope-conditions';
import {
  loadTraineeProgress,
  requireProgressScope,
} from '@/lib/trainer/trainee-progress';

export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    // Only trainees of the own organization (the super admin sees every one)
    // and, with a chosen occupation (x-catalog), of that occupation. The
    // platform-owner flag of an organization does not widen the list.
    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;

    const traineeRows = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
        avatarUrl: profiles.avatarUrl,
        isActive: profiles.isActive,
        trainerActivated: profiles.trainerActivated,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
        assignedTrainerId: profiles.assignedTrainerId,
      })
      .from(profiles)
      .where(traineeScope.condition);

    const traineeIds = traineeRows.map(t => String(t.id));

    // Progress and number of courses: ONE figure for every trainer page
    // (src/lib/trainer/trainee-progress.ts), counted over the courses of the
    // chosen occupation only (the tab FIAE never counts the courses of KfBM)
    const scope = await requireProgressScope(session, req);
    if (isErrorResponse(scope)) return scope;
    const progress = await loadTraineeProgress(traineeIds, scope);

    const response = {
      trainees: traineeRows.map(t => {
        const own = progress.byTrainee.get(String(t.id));
        return {
          id: t.id,
          firstName: t.firstName,
          lastName: t.lastName,
          email: t.email,
          full_name: t.fullName,
          fullName: t.fullName,
          avatar_url: t.avatarUrl,
          avatarUrl: t.avatarUrl,
          assignedTrainerId: t.assignedTrainerId,
          assigned_trainer_id: t.assignedTrainerId,
          ausbildungDurationYears: t.ausbildungDurationYears ?? 3,
          ausbildung_duration_years: t.ausbildungDurationYears ?? 3,
          progress: own?.pct ?? 0,
          coursesCount: own?.courses.size ?? 0,
          isActive: Boolean(t.isActive),
          trainerActivated: Boolean(t.trainerActivated),
        };
      }),
    };

    return NextResponse.json(response, { headers: cacheHeaders.none });
  } catch (e) {
    console.error('List trainer trainees error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
