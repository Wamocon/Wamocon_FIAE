/**
 * Trainer Block [blockId] API - DELETE and PATCH operations
 * 
 * DELETE /api/trainer/blocks/[blockId] - Delete a trainer-created block
 * PATCH  /api/trainer/blocks/[blockId] - Update a trainer-created block
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and } from 'drizzle-orm';
import { ausbildungBlocks, profiles, notifications } from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';

// Helper to get ISO week number
function getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// DELETE /api/trainer/blocks/[blockId]
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ blockId: string }> }
) {
    try {
        const { blockId } = await params;

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

        // Only allow deletion of trainer-created blocks
        if (block.blockType !== 'TRAINER_BLOCKER') {
            return NextResponse.json({ error: 'Can only delete trainer-created blocks' }, { status: 403 });
        }

        const organizationId = await getUserOrgId(String(block.createdByTrainerId || block.traineeId));

        // Delete the block
        await db.delete(ausbildungBlocks).where(eq(ausbildungBlocks.id, blockId));

        // Notify trainee that block was cancelled
        if (block.traineeId) {
            try {
                const blockLabel = block.title || block.blockType || 'Block';
                await db.insert(notifications).values({
                    userId: String(block.traineeId),
                    type: 'BLOCK_CANCELLED',
                    title: 'Block storniert',
                    message: `Der Block "${blockLabel}" wurde storniert.`,
                    linkUrl: '/trainee/school?tab=blocks',
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
        const { blockId } = await params;
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
            .where(eq(ausbildungBlocks.id, blockId))
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
                    linkUrl: '/trainee/school?tab=blocks',
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
