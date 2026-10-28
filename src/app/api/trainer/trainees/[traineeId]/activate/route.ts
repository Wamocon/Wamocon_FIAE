import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import {
  activityLog,
  courseMembers,
  enablers,
  traineeEnablerOverrides,
  traineeUseCaseOverrides,
  quizAssignments,
  notifications,
} from '@/db/migrations/schemas/schema';
import { getUserOrgId, getUserOrgIdStrict } from '@/lib/auth-helpers';
import { invalidateTraineeListCaches } from '@/lib/catalog/trainee-cache';
import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import {
  ensureContentInScope,
  requireCatalogScope,
  type CatalogContentKind,
} from '@/lib/catalog/scope';

type ItemType = 'ENABLER' | 'USE_CASE' | 'GLOBAL_QUIZ';

/**
 * PATCH the exception of one trainee (rights unchanged: any trainer level
 * caller inside the scope of the trainee).
 *
 * ENABLER: the exception to the order of work. isActive true releases the
 * enabler for this trainee out of turn, false locks it, null removes the
 * exception (the order applies again). The enabler has to belong to a course
 * the trainee works in, the trainee needs an organization (without one nothing
 * is written), and the change is written to the activity log in the same
 * transaction. The effect is described in src/lib/catalog/progression.ts.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ traineeId: string }> }) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { traineeId } = await params;
    const body = await req.json();
    const { itemType, itemId, isActive } = body as {
      itemType: ItemType;
      itemId: string;
      isActive: boolean | null;
    };
    // The acting trainer is the authenticated user, never a client value
    const trainerId = session.id;

    // Only a trainee of the own organization (the super admin: any) and of the
    // chosen occupation, everything else is not found and stays untouched.
    const access = await requireTraineeAccess(session, traineeId, req);
    if (isErrorResponse(access)) return access;

    // null (remove the exception) only for an enabler
    const validValue =
      typeof isActive === 'boolean' ||
      (itemType === 'ENABLER' && isActive === null);
    if (!itemType || !itemId || !validValue) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // The item has to lie inside the occupations of the caller
    const itemKinds: Record<ItemType, CatalogContentKind> = {
      ENABLER: 'enabler',
      USE_CASE: 'useCase',
      GLOBAL_QUIZ: 'quiz',
    };
    const itemKind = itemKinds[itemType];
    if (itemKind) {
      const catalogScope = await requireCatalogScope(session, req);
      if (isErrorResponse(catalogScope)) return catalogScope;
      const deniedItem = await ensureContentInScope(catalogScope, itemKind, String(itemId));
      if (deniedItem) return deniedItem;
    }

    let organizationId: string;
    if (itemType === 'ENABLER') {
      // Fail closed: no organization, no exception (and no fallback to the
      // platform organization, which getUserOrgId would use)
      try {
        organizationId = await getUserOrgIdStrict(traineeId);
      } catch {
        return NextResponse.json(
          { error: 'Trainee has no organization' },
          { status: 409 }
        );
      }
    } else {
      organizationId = await getUserOrgId(traineeId);
    }

    switch (itemType) {
      case 'ENABLER': {
        // The enabler has to belong to a course the trainee works in
        const [owner] = await db
          .select({ courseId: enablers.courseId })
          .from(enablers)
          .where(eq(enablers.id, itemId as any));
        const [member] = owner
          ? await db
              .select({ userId: courseMembers.userId })
              .from(courseMembers)
              .where(
                and(
                  eq(courseMembers.courseId, owner.courseId),
                  eq(courseMembers.userId, traineeId as any),
                  eq(courseMembers.role, 'TRAINEE' as any)
                )
              )
          : [];
        if (!member) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const [before] = await db
          .select({ isActive: traineeEnablerOverrides.isActive })
          .from(traineeEnablerOverrides)
          .where(
            and(
              eq(traineeEnablerOverrides.traineeId, traineeId as any),
              eq(traineeEnablerOverrides.enablerId, itemId as any)
            )
          );
        // The exception and its protocol entry stand or fall together
        await db.transaction(async tx => {
          if (isActive === null) {
            await tx
              .delete(traineeEnablerOverrides)
              .where(
                and(
                  eq(traineeEnablerOverrides.traineeId, traineeId as any),
                  eq(traineeEnablerOverrides.enablerId, itemId as any)
                )
              );
          } else {
            // createdAt carries the time of the last change
            await tx
              .insert(traineeEnablerOverrides)
              .values({ traineeId: traineeId as any, enablerId: itemId as any, isActive })
              .onConflictDoUpdate({
                target: [traineeEnablerOverrides.traineeId, traineeEnablerOverrides.enablerId],
                set: { isActive, createdAt: new Date() },
              });
          }
          await tx.insert(activityLog).values({
            userId: trainerId,
            organizationId,
            activityType: 'TRAINEE_ENABLER_OVERRIDE',
            relatedItemId: itemId as any,
            relatedItemTable: 'enablers',
            context: {
              traineeId,
              enablerId: itemId,
              previous: before ? (before.isActive ?? null) : null,
              value: isActive,
            },
          });
        });
        // No list of the trainee is cached with the state of an enabler (the
        // course detail is not cached), so no cache has to be cleared here
        break;
      }
      case 'USE_CASE': {
        await db
          .insert(traineeUseCaseOverrides)
          .values({ traineeId: traineeId as any, useCaseId: itemId as any, isActive })
          .onConflictDoUpdate({
            target: [traineeUseCaseOverrides.traineeId, traineeUseCaseOverrides.useCaseId],
            set: { isActive },
          });
        break;
      }
      case 'GLOBAL_QUIZ': {
        // For global quizzes, assignment table represents active state: insert/delete
        if (isActive) {
          await db
            .insert(quizAssignments)
            .values({ quizId: itemId as any, traineeId: traineeId as any, assignedById: (trainerId as any) ?? traineeId, organizationId })
            .onConflictDoNothing();
        } else {
          await db.delete(quizAssignments).where(and(eq(quizAssignments.quizId, itemId as any), eq(quizAssignments.traineeId, traineeId as any)));
        }
        break;
      }
      default:
        return NextResponse.json({ error: 'Unknown itemType' }, { status: 400 });
    }

    // an assignment of a global quiz shows in the cached quiz list of the trainee
    if (itemType === 'GLOBAL_QUIZ') invalidateTraineeListCaches();

    // Notify the trainee about the activation change
    try {
      const typeLabel = itemType === 'ENABLER' ? 'Lesson' : itemType === 'USE_CASE' ? 'Use Case' : 'Quiz';
      const statusLabel =
        itemType === 'ENABLER'
          ? isActive === null
            ? 'wieder in die Reihenfolge eingeordnet'
            : isActive
              ? 'außer der Reihe freigegeben'
              : 'gesperrt'
          : isActive
            ? 'aktiviert'
            : 'deaktiviert';
      await db.insert(notifications).values({
        userId: traineeId,
        actorId: trainerId || undefined,
        type: 'TRAINEE_ITEM_TOGGLED',
        title: `${typeLabel} ${statusLabel}`,
        message: `Ein ${typeLabel} wurde für dich ${statusLabel}.`,
        linkUrl: '/trainee/modules',
        context: { itemType, itemId, isActive },
        organizationId,
      });
    } catch (notifyErr) {
      console.warn('Failed to notify trainee for activation toggle', notifyErr);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Activation toggle error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
