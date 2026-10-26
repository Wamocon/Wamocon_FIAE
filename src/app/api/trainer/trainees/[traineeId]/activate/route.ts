import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import {
  traineeEnablerOverrides,
  traineeUseCaseOverrides,
  quizAssignments,
  notifications,
} from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import {
  ensureContentInScope,
  requireCatalogScope,
  type CatalogContentKind,
} from '@/lib/catalog/scope';

type ItemType = 'ENABLER' | 'USE_CASE' | 'GLOBAL_QUIZ';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ traineeId: string }> }) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { traineeId } = await params;
    const body = await req.json();
    const { itemType, itemId, isActive } = body as {
      itemType: ItemType;
      itemId: string;
      isActive: boolean;
    };
    // The acting trainer is the authenticated user, never a client value
    const trainerId = session.id;

    // Only a trainee of the own organization (the super admin: any) and of the
    // chosen occupation, everything else is not found and stays untouched.
    const access = await requireTraineeAccess(session, traineeId, req);
    if (isErrorResponse(access)) return access;

    if (!itemType || !itemId || typeof isActive !== 'boolean') {
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

    const organizationId = await getUserOrgId(traineeId);

    switch (itemType) {
      case 'ENABLER': {
        // Upsert override
        await db
          .insert(traineeEnablerOverrides)
          .values({ traineeId: traineeId as any, enablerId: itemId as any, isActive })
          .onConflictDoUpdate({
            target: [traineeEnablerOverrides.traineeId, traineeEnablerOverrides.enablerId],
            set: { isActive },
          });
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

    // Notify the trainee about the activation change
    try {
      const typeLabel = itemType === 'ENABLER' ? 'Lesson' : itemType === 'USE_CASE' ? 'Use Case' : 'Quiz';
      const statusLabel = isActive ? 'aktiviert' : 'deaktiviert';
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
