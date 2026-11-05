import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';
import { apiCache } from '@/lib/api-cache';
import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import {
  loadTraineeProgress,
  requireProgressScope,
} from '@/lib/trainer/trainee-progress';
import {
  isTrainerInOrgScope,
  traineeRecordCondition,
} from '@/lib/auth/trainee-scope-conditions';

/** The longest name that fits the lists and the header. */
const FULL_NAME_MAX = 120;

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

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

    // Progress: the one figure of every trainer page, over the courses of the
    // chosen occupation (src/lib/trainer/trainee-progress.ts). It used to count
    // rows of enabler_completions over the courses of the assigned trainer, so
    // the PDF export showed 0 % where the detail page showed 46 %.
    const scope = await requireProgressScope(session, req);
    if (isErrorResponse(scope)) return scope;
    const progress = await loadTraineeProgress([traineeId], scope);
    const progressPct = progress.byTrainee.get(traineeId)?.pct ?? 0;

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
    if (typeof body?.full_name === 'string') {
      // A name is required: an empty one left the header with "Auszubildender"
      // and every list with an empty line (WMCNL-2985)
      const fullName = body.full_name.trim();
      if (!fullName) {
        return NextResponse.json(
          { error: 'full_name must not be empty', code: 'FULL_NAME_REQUIRED' },
          { status: 400 }
        );
      }
      if (fullName.length > FULL_NAME_MAX) {
        return NextResponse.json(
          { error: 'full_name is too long', code: 'FULL_NAME_TOO_LONG' },
          { status: 400 }
        );
      }
      updates.fullName = fullName;
    }
    if (typeof body?.avatar_url === 'string') {
      // An empty value removes the picture, anything else has to be a web
      // address (the value ends up in an image tag)
      const avatarUrl = body.avatar_url.trim();
      if (avatarUrl && !isWebUrl(avatarUrl)) {
        return NextResponse.json(
          {
            error: 'avatar_url must be an http(s) address',
            code: 'AVATAR_URL_INVALID',
          },
          { status: 400 }
        );
      }
      updates.avatarUrl = avatarUrl || null;
    }
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
