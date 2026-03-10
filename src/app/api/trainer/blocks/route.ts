/**
 * Trainer Blocks API - CRUD operations for trainer-created blockers
 * 
 * GET  /api/trainer/blocks?traineeId=... - List blocks for a trainee (trainer view)
 * POST /api/trainer/blocks - Create blocker for trainee
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { ausbildungBlocks, profiles, notifications } from '@/db/migrations/schemas/schema';
import { sendBlockerInvite } from '@/lib/email';
import { getUserOrgId } from '@/lib/auth-helpers';

// Helper to calculate Ausbildungsjahr from startOfTrainingDate
function calculateAusbildungsjahr(startDate: Date): number {
    const now = new Date();
    const monthsSince = (now.getFullYear() - startDate.getFullYear()) * 12 +
        (now.getMonth() - startDate.getMonth());

    if (monthsSince < 12) return 1;
    if (monthsSince < 24) return 2;
    return 3;
}

// Helper to get current Schuljahr (e.g., "2026/2027")
function getCurrentSchuljahr(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    if (month >= 8) {
        return `${year}/${year + 1}`;
    }
    return `${year - 1}/${year}`;
}

// Helper to get ISO week number
function getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// GET /api/trainer/blocks?traineeId=...&year=...
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const traineeId = searchParams.get('traineeId');
        const year = searchParams.get('year');

        if (!traineeId) {
            return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });
        }

        // Build query conditions
        const conditions = [eq(ausbildungBlocks.traineeId, traineeId as any)];

        if (year) {
            // OPTIONAL: Filter by year is tricky for spanning blocks.
            // For now, we return ALL blocks to ensure nothing is missed (e.g. crossing year boundaries).
            // The dataset for a single trainee is small enough.
            // conditions.push(eq(ausbildungBlocks.year, parseInt(year, 10)));
        }

        const rows = await db
            .select()
            .from(ausbildungBlocks)
            .where(and(...conditions))
            .orderBy(ausbildungBlocks.year, ausbildungBlocks.calendarWeek);

        return NextResponse.json({
            blocks: rows,
            meta: {
                currentSchuljahr: getCurrentSchuljahr(),
                currentWeek: getISOWeek(new Date()),
                currentYear: new Date().getFullYear(),
            }
        });
    } catch (e) {
        console.error('Trainer list blocks error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// POST /api/trainer/blocks
// Body: { trainerId, traineeIds, blockType, startDate, endDate, title?, notes?, description?, sendInvitation? } (Updated for Multi-Select)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            trainerId,
            traineeId, // Backward compatibility or single 
            traineeIds: providedTraineeIds, // New array support
            startDate,
            endDate,
            blockType = 'TRAINER_BLOCKER',
            title,
            notes,
            description,
            sendInvitation = true,
            examSubType,
        } = body;

        // Validation
        if (!trainerId) return NextResponse.json({ error: 'trainerId required' }, { status: 400 });

        // Resolve trainee IDs list
        const targetTraineeIds = providedTraineeIds || (traineeId ? [traineeId] : []);
        if (targetTraineeIds.length === 0) return NextResponse.json({ error: 'At least one traineeId required' }, { status: 400 });

        if (!startDate) return NextResponse.json({ error: 'startDate required' }, { status: 400 });
        if (!endDate) return NextResponse.json({ error: 'endDate required' }, { status: 400 });

        const validBlockTypes = ['SCHOOL', 'COMPANY', 'HOLIDAY', 'EXAM', 'PERSONAL', 'SONSTIGES', 'TRAINER_BLOCKER'];
        if (!validBlockTypes.includes(blockType)) {
            return NextResponse.json({ error: `Valid blockType required (${validBlockTypes.join(', ')})` }, { status: 400 });
        }

        // Get trainer info once
        const [trainer] = await db
            .select({
                firstName: profiles.firstName,
                lastName: profiles.lastName,
                email: profiles.email,
                role: profiles.role,
            })
            .from(profiles)
            .where(eq(profiles.id, trainerId));

        if (!trainer || trainer.role !== 'TRAINER') {
            return NextResponse.json({ error: 'Unauthorized: Trainer access required' }, { status: 403 });
        }

        const organizationId = await getUserOrgId(trainerId);

        // Process each trainee
        const results = [];
        const errors = [];

        for (const tid of targetTraineeIds) {
            try {
                const [trainee] = await db
                    .select({
                        firstName: profiles.firstName,
                        lastName: profiles.lastName,
                        email: profiles.email,
                        startOfTrainingDate: profiles.startOfTrainingDate,
                    })
                    .from(profiles)
                    .where(eq(profiles.id, tid));

                if (!trainee) {
                    errors.push(`Trainee ${tid} not found`);
                    continue;
                }

                const start = new Date(startDate);
                const end = new Date(endDate);

                // Check for duplicates if it's an EXAM block with a subtype
                if (blockType === 'EXAM' && examSubType) {
                    const existing = await db
                        .select()
                        .from(ausbildungBlocks)
                        .where(
                            and(
                                eq(ausbildungBlocks.traineeId, tid as any),
                                eq(ausbildungBlocks.blockType, 'EXAM'),
                                eq(ausbildungBlocks.examSubType, examSubType)
                            )
                        )
                        .limit(1);

                    if (existing.length > 0) {
                        errors.push(`Duplicate exam block for trainee ${tid}: ${examSubType} already exists.`);
                        continue;
                    }
                }

                // Calculate week and year
                const calendarWeek = getISOWeek(start);
                const year = start.getFullYear();
                const schuljahr = getCurrentSchuljahr();
                const ausbildungsjahr = trainee.startOfTrainingDate
                    ? calculateAusbildungsjahr(trainee.startOfTrainingDate)
                    : 1;

                // Create the block
                const [row] = await db
                    .insert(ausbildungBlocks)
                    .values({
                        traineeId: tid as any,
                        schuljahr,
                        ausbildungsjahr,
                        calendarWeek,
                        year,
                        startDate: start,
                        endDate: end,
                        blockType,
                        title: title || null,
                        notes: notes || null,
                        description: description || null,
                        examSubType: examSubType || null,
                        isPersonal: false,
                        createdByTrainerId: trainerId,
                        inviteeEmails: trainee.email,
                        organizationId,
                    })
                    .returning();

                // Send email invitation to trainee if requested
                if (sendInvitation && trainee.email) {
                    const trainerName = `${trainer.firstName || ''} ${trainer.lastName || ''}`.trim() || 'Trainer';
                    const traineeName = `${trainee.firstName || ''} ${trainee.lastName || ''}`.trim() || 'Trainee';

                    await sendBlockerInvite([trainee.email], {
                        blockId: row.id,
                        blockType,
                        title,
                        description,
                        notes,
                        startDate: start,
                        endDate: end,
                        traineeName,
                        traineeEmail: trainee.email,
                        createdByTrainer: true,
                        trainerName,
                    });
                }

                // In-app notification for trainee
                try {
                    const startStr = start.toLocaleDateString('de-DE');
                    const endStr = end.toLocaleDateString('de-DE');
                    const blockLabel = title || blockType;
                    await db.insert(notifications).values({
                        userId: tid,
                        actorId: trainerId,
                        type: 'BLOCK_SCHEDULED',
                        title: 'Neuer Block geplant',
                        message: `Ein neuer Block "${blockLabel}" wurde für ${startStr} – ${endStr} geplant.`,
                        linkUrl: '/trainee/school?tab=blocks',
                        context: { blockId: row.id, blockType, startDate: startDate, endDate: endDate },
                        organizationId,
                    });
                } catch (notifyErr) {
                    console.warn(`Failed to notify trainee ${tid} for block creation`, notifyErr);
                }

                results.push(row);
            } catch (innerErr) {
                console.error(`Error processing trainee ${tid}:`, innerErr);
                errors.push(`Error for ${tid}`);
            }
        }

        // If at least one succeeded, return 201 (or 207 Multi-Status if strict, but 201 is fine for UI)
        // If single trainee, return the block like before to not break UI if it expects single object
        if (targetTraineeIds.length === 1 && results.length === 1) {
            return NextResponse.json({ id: results[0].id, block: results[0] }, { status: 201 });
        }

        return NextResponse.json({
            message: 'Batch processing complete',
            createdCount: results.length,
            errorCount: errors.length,
            blocks: results
        }, { status: 201 });

    } catch (e) {
        console.error('Trainer create block error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
