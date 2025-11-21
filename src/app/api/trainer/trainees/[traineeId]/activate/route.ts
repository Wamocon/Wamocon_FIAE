import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import {
  profiles,
  traineeEnablerOverrides,
  traineeUseCaseOverrides,
  quizAssignments,
} from '@/db/migrations/schemas/schema';

type ItemType = 'ENABLER' | 'USE_CASE' | 'GLOBAL_QUIZ';

export async function PATCH(req: NextRequest, { params }: { params: { traineeId: string } }) {
  try {
    const { traineeId } = params;
    const body = await req.json();
    const { itemType, itemId, isActive, trainerId } = body as {
      itemType: ItemType;
      itemId: string;
      isActive: boolean;
      trainerId?: string;
    };

    // Optional auth: ensure trainer is TRAINER
    if (trainerId) {
      const [t] = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, trainerId as any)).limit(1);
      if (!t || t.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!itemType || !itemId || typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

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
      // Geschäftsprozesse removed
      case 'GLOBAL_QUIZ': {
        // For global quizzes, assignment table represents active state: insert/delete
        if (isActive) {
          await db
            .insert(quizAssignments)
            .values({ quizId: itemId as any, traineeId: traineeId as any, assignedById: (trainerId as any) ?? traineeId })
            .onConflictDoNothing();
        } else {
          await db.delete(quizAssignments).where(and(eq(quizAssignments.quizId, itemId as any), eq(quizAssignments.traineeId, traineeId as any)));
        }
        break;
      }
      default:
        return NextResponse.json({ error: 'Unknown itemType' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Activation toggle error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
