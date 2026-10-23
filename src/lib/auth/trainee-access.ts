/**
 * Responsibility check for trainer-level callers: may this session work with
 * the given trainee? Builds on the trainer scope (src/lib/trainer-scope.ts):
 * a trainer sees the trainees of their own organization (or the ones assigned
 * to them), admins see their organization, the super admin sees everything.
 */

import { NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import type { SessionUser } from '@/lib/auth/session';
import {
  getTrainerScope,
  isTraineeVisibleToTrainer,
  type TrainerScope,
} from '@/lib/trainer-scope';

/** Same default as getUserOrgId for profiles without an organization. */
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

export type TraineeAccess = {
  trainee: {
    id: string;
    role: string | null;
    organizationId: string | null;
    assignedTrainerId: string | null;
  };
  scope: TrainerScope;
};

/**
 * Resolve the trainee and check that the session may access them. Returns the
 * trainee and scope, or a ready-made 404/403 response.
 */
export async function requireTraineeAccess(
  session: SessionUser,
  traineeId: string
): Promise<TraineeAccess | NextResponse> {
  const [row] = traineeId
    ? await withDbRetry(() =>
        db
          .select({
            id: profiles.id,
            role: profiles.role,
            organizationId: profiles.organizationId,
            assignedTrainerId: profiles.assignedTrainerId,
          })
          .from(profiles)
          .where(eq(profiles.id, traineeId as any))
          .limit(1)
      )
    : [];
  if (!row) {
    return NextResponse.json({ error: 'Trainee not found' }, { status: 404 });
  }

  const scope = await getTrainerScope(session.id);
  if (!scope) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const trainee = {
    id: String(row.id),
    role: row.role ?? null,
    organizationId: row.organizationId ? String(row.organizationId) : null,
    assignedTrainerId: row.assignedTrainerId
      ? String(row.assignedTrainerId)
      : null,
  };
  const visible = isTraineeVisibleToTrainer(scope, {
    assignedTrainerId: trainee.assignedTrainerId,
    organizationId: trainee.organizationId ?? DEFAULT_ORG_ID,
  });
  if (!visible) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { trainee, scope };
}
