import db from '@/db';
import { profiles } from '@/db/migrations/schemas/schema';
import { and, eq, inArray, or } from 'drizzle-orm';
import { getUserOrgId, verifyPlatformOwner } from '@/lib/auth-helpers';

const TRAINER_LEVEL_ROLES = ['ADMIN', 'TEMP_ADMIN', 'TRAINER'] as const;

export type TrainerScope = {
  id: string;
  role: string;
  organizationId: string | null;
  isPlatformOwner: boolean;
  canSeeOrgWide: boolean;
  profileIds: string[];
};

export async function getTrainerScope(
  trainerId: string
): Promise<TrainerScope | null> {
  if (!trainerId) return null;

  const [requester] = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      role: profiles.role,
      organizationId: profiles.organizationId,
    })
    .from(profiles)
    .where(eq(profiles.id, trainerId as any));

  if (
    !requester ||
    !TRAINER_LEVEL_ROLES.includes(requester.role as any)
  ) {
    return null;
  }

  const organizationId =
    requester.organizationId ?? (await getUserOrgId(trainerId));
  const isPlatformOwner = await verifyPlatformOwner(trainerId);
  const canSeeOrgWide =
    requester.role === 'ADMIN' || requester.role === 'TEMP_ADMIN';

  const aliasConditions: any[] = [eq(profiles.id, trainerId as any)];
  if (requester.email) {
    aliasConditions.push(eq(profiles.email, requester.email));
  }
  if (requester.fullName && organizationId) {
    aliasConditions.push(
      and(
        eq(profiles.role, 'TRAINER'),
        eq(profiles.organizationId, organizationId as any),
        eq(profiles.fullName, requester.fullName)
      )
    );
  }

  const aliases = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        inArray(profiles.role, TRAINER_LEVEL_ROLES as any),
        or(...aliasConditions)!
      )
    );

  return {
    id: trainerId,
    role: requester.role,
    organizationId,
    isPlatformOwner,
    canSeeOrgWide,
    profileIds: Array.from(
      new Set([trainerId, ...aliases.map(alias => String(alias.id))])
    ),
  };
}

export function isTraineeVisibleToTrainer(
  scope: TrainerScope,
  trainee: {
    assignedTrainerId?: string | null;
    organizationId?: string | null;
  }
) {
  if (scope.canSeeOrgWide) {
    return (
      scope.isPlatformOwner ||
      !scope.organizationId ||
      String(trainee.organizationId || '') === String(scope.organizationId)
    );
  }

  if (scope.profileIds.includes(String(trainee.assignedTrainerId || ''))) {
    return true;
  }

  return (
    !!scope.organizationId &&
    String(trainee.organizationId || '') === String(scope.organizationId)
  );
}
