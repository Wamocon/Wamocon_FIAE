/**
 * Trainer Block [blockId] API - DELETE and PATCH operations
 * 
 * DELETE /api/trainer/blocks/[blockId] - Delete a trainer-created block
 * PATCH  /api/trainer/blocks/[blockId] - Update a trainer-created block
 */

import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and } from 'drizzle-orm';
import { ausbildungBlocks, profiles, notifications } from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import { notFoundUnlessUuid } from '@/lib/uuid';
import { ensureSchoolRowInChosenCatalog } from '@/lib/school/catalog-access';
import { getISOWeek } from '@/lib/school/schuljahr';

// A block of another chosen occupation is answered like a missing one
const blockNotFound = () => NextResponse.json({ error: 'Block not found' }, { status: 404 });

// DELETE /api/trainer/blocks/[blockId]
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ blockId: string }> }
) {
    try {
        const session = await requireTrainer(req);
        if (isErrorResponse(session)) return session;

        const { blockId } = await params;
        const blockIdNotFound = notFoundUnlessUuid(blockId, 'Block not found');
        if (blockIdNotFound) return blockIdNotFound;

        if (!blockId) {
            return NextResponse.json({ error: 'Block ID required' }, { status: 400 });
        }

        // Check if the block exists and is a trainer-created block
        const [block] = await db
            .select()
            .from(ausbildungBlocks)
            .where(eq(ausbildungBlocks.id, blockId));

        if (!block) {
            return NextResponse.json({ error: 'Block not found' }, { status: 404 });
        }

        const access = await requireTraineeAccess(session, String(block.traineeId), req, 'Block not found');
        if (isErrorResponse(access)) return access;
        const outsideCatalog = await ensureSchoolRowInChosenCatalog(session, req, block, blockNotFound);
        if (outsideCatalog) return outsideCatalog;

        // Only allow deletion of trainer-created blocks
        if (block.blockType !== 'TRAINER_BLOCKER') {
            return NextResponse.json({ error: 'Can only delete trainer-created blocks' }, { status: 403 });
        }

        const organizationId = await getUserOrgId(String(block.createdByTrainerId || block.traineeId));

        // Delete the block
        await db
            .delete(ausbildungBlocks)
            .where(and(eq(ausbildungBlocks.id, blockId), eq(ausbildungBlocks.traineeId, access.traineeId as any)));

        // Notify trainee that block was cancelled
        if (block.traineeId) {
            try {
                const blockLabel = block.title || block.blockType || 'Block';
                await db.insert(notifications).values({
                    userId: String(block.traineeId),
                    type: 'BLOCK_CANCELLED',
                    title: 'Block storniert',
                    message: `Der Block "${blockLabel}" wurde storniert.`,
                    linkUrl: '/trainee/school?tab=calendar',
                    context: { blockId, blockType: block.blockType },
                    organizationId,
                });
            } catch (notifyErr) {
                console.warn('Failed to notify trainee for block deletion', notifyErr);
            }
        }

        return NextResponse.json({ success: true, message: 'Block deleted' });
    } catch (e) {
        console.error('Delete block error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PATCH /api/trainer/blocks/[blockId]
// Body: { title?, description?, startDate?, endDate? }
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ blockId: string }> }
) {
    try {
        const session = await requireTrainer(req);
        if (isErrorResponse(session)) return session;

        const { blockId } = await params;
        const blockIdNotFound = notFoundUnlessUuid(blockId, 'Block not found');
        if (blockIdNotFound) return blockIdNotFound;
        const body = await req.json();

        if (!blockId) {
            return NextResponse.json({ error: 'Block ID required' }, { status: 400 });
        }

        // Check if the block exists and is a trainer-created block
        const [existingBlock] = await db
            .select()
            .from(ausbildungBlocks)
            .where(eq(ausbildungBlocks.id, blockId));

        if (!existingBlock) {
            return NextResponse.json({ error: 'Block not found' }, { status: 404 });
        }

        const access = await requireTraineeAccess(session, String(existingBlock.traineeId), req, 'Block not found');
        if (isErrorResponse(access)) return access;
        const outsideCatalog = await ensureSchoolRowInChosenCatalog(session, req, existingBlock, blockNotFound);
        if (outsideCatalog) return outsideCatalog;

        // Only allow editing of trainer-created blocks
        if (existingBlock.blockType !== 'TRAINER_BLOCKER') {
            return NextResponse.json({ error: 'Can only edit trainer-created blocks' }, { status: 403 });
        }

        // Build update object
        const updates: Record<string, any> = {};

        if (body.title !== undefined) {
            updates.title = body.title;
        }
        if (body.description !== undefined) {
            updates.description = body.description;
        }
        if (body.notes !== undefined) {
            updates.notes = body.notes;
        }
        if (body.startDate) {
            const startDate = new Date(body.startDate);
            updates.startDate = startDate;
            updates.year = startDate.getFullYear();
            updates.calendarWeek = getISOWeek(startDate);
        }
        if (body.endDate) {
            updates.endDate = new Date(body.endDate);
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
        }

        // Update the block
        const [updatedBlock] = await db
            .update(ausbildungBlocks)
            .set(updates)
            .where(and(eq(ausbildungBlocks.id, blockId), eq(ausbildungBlocks.traineeId, access.traineeId as any)))
            .returning();

        const organizationId = await getUserOrgId(String(existingBlock.createdByTrainerId || existingBlock.traineeId));

        // Notify trainee about block update
        if (existingBlock.traineeId) {
            try {
                const blockLabel = updatedBlock.title || updatedBlock.blockType || 'Block';
                await db.insert(notifications).values({
                    userId: String(existingBlock.traineeId),
                    type: 'BLOCK_UPDATED',
                    title: 'Block aktualisiert',
                    message: `Der Block "${blockLabel}" wurde aktualisiert.`,
                    linkUrl: '/trainee/school?tab=calendar',
                    context: { blockId, blockType: updatedBlock.blockType },
                    organizationId,
                });
            } catch (notifyErr) {
                console.warn('Failed to notify trainee for block update', notifyErr);
            }
        }

        return NextResponse.json({ block: updatedBlock });
    } catch (e) {
        console.error('Update block error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
