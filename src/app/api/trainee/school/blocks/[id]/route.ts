/**
 * Block Calendar Single Item API - CRUD operations for a specific block
 * 
 * GET    /api/trainee/school/blocks/[id] - Get single block
 * PUT    /api/trainee/school/blocks/[id] - Update block
 * DELETE /api/trainee/school/blocks/[id] - Delete block
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { ausbildungBlocks, profiles } from '@/db/migrations/schemas/schema';
import { getTrainingPhase } from '@/lib/ausbildung/duration';
import { loadPhasePlanForUser } from '@/lib/catalog/phase-plan-db';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { refreshTraineeDashboard } from '@/lib/school/dashboard-cache';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// A block of someone else is answered like a missing one
const notFound = () =>
    NextResponse.json({ error: 'Block not found' }, { status: 404 });

// GET /api/trainee/school/blocks/[id]
export async function GET(req: NextRequest, { params }: RouteParams) {
    const session = await requireUser(req);
    if (isErrorResponse(session)) return session;

    try {
        const { id } = await params;

        const [block] = await db
            .select()
            .from(ausbildungBlocks)
            .where(eq(ausbildungBlocks.id, id as any));

        if (!block || String(block.traineeId) !== session.id) {
            return notFound();
        }

        return NextResponse.json({ block });
    } catch (e) {
        console.error('Get block error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PUT /api/trainee/school/blocks/[id]
// Body: Partial block fields to update
export async function PUT(req: NextRequest, { params }: RouteParams) {
    const session = await requireUser(req);
    if (isErrorResponse(session)) return session;

    try {
        const { id } = await params;
        const body = await req.json();

        // Check block exists and belongs to the session user
        const [existing] = await db
            .select()
            .from(ausbildungBlocks)
            .where(eq(ausbildungBlocks.id, id as any));

        if (!existing || String(existing.traineeId) !== session.id) {
            return notFound();
        }

        // Build update object - only include provided fields
        const updateData: Record<string, any> = {};

        if (body.calendarWeek !== undefined) updateData.calendarWeek = body.calendarWeek;
        if (body.year !== undefined) updateData.year = body.year;
        if (body.startDate !== undefined) updateData.startDate = new Date(body.startDate);
        if (body.endDate !== undefined) updateData.endDate = new Date(body.endDate);
        if (body.blockType !== undefined) {
            if (!['SCHOOL', 'COMPANY', 'HOLIDAY', 'EXAM', 'PERSONAL', 'SONSTIGES', 'TRAINER_BLOCKER'].includes(body.blockType)) {
                return NextResponse.json({ error: 'Invalid blockType' }, { status: 400 });
            }
            updateData.blockType = body.blockType;
        }
        if (body.blockNumber !== undefined) updateData.blockNumber = body.blockNumber;
        if (body.title !== undefined) updateData.title = body.title;
        if (body.notes !== undefined) updateData.notes = body.notes;
        if (body.schuljahr !== undefined) updateData.schuljahr = body.schuljahr;
        if (body.ausbildungsjahr !== undefined) updateData.ausbildungsjahr = body.ausbildungsjahr;
        if (body.isPersonal !== undefined) updateData.isPersonal = body.isPersonal;

        if (body.startDate !== undefined || body.ausbildungsjahr !== undefined) {
            const [trainee] = await db
                .select({
                    startOfTrainingDate: profiles.startOfTrainingDate,
                    ausbildungDurationYears: profiles.ausbildungDurationYears,
                })
                .from(profiles)
                .where(eq(profiles.id, existing.traineeId));

            if (trainee?.startOfTrainingDate) {
                // Phase one of the trainee's occupation (KfBM 15 months, FIAE 18)
                const phasePlan = await loadPhasePlanForUser(
                    existing.traineeId,
                    trainee.ausbildungDurationYears
                );
                updateData.ausbildungsjahr = getTrainingPhase(
                    trainee.startOfTrainingDate,
                    trainee.ausbildungDurationYears,
                    body.startDate !== undefined ? new Date(body.startDate) : existing.startDate,
                    phasePlan.phaseMonths[0]
                );
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        const [updated] = await db
            .update(ausbildungBlocks)
            .set(updateData)
            .where(and(eq(ausbildungBlocks.id, id as any), eq(ausbildungBlocks.traineeId, session.id as any)))
            .returning();

        return NextResponse.json({ block: updated });
    } catch (e) {
        console.error('Update block error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE /api/trainee/school/blocks/[id]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
    const session = await requireUser(req);
    if (isErrorResponse(session)) return session;

    try {
        const { id } = await params;

        // Check block exists and belongs to the session user
        const [existing] = await db
            .select({ id: ausbildungBlocks.id, traineeId: ausbildungBlocks.traineeId })
            .from(ausbildungBlocks)
            .where(eq(ausbildungBlocks.id, id as any));

        if (!existing || String(existing.traineeId) !== session.id) {
            return notFound();
        }

        await db
            .delete(ausbildungBlocks)
            .where(and(eq(ausbildungBlocks.id, id as any), eq(ausbildungBlocks.traineeId, session.id as any)));

        refreshTraineeDashboard();
        return NextResponse.json({ success: true, deleted: id });
    } catch (e) {
        console.error('Delete block error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
