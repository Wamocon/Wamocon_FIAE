/**
 * Block Calendar API - CRUD operations for Ausbildung blocks
 * 
 * GET  /api/trainee/school/blocks - List blocks for trainee
 * POST /api/trainee/school/blocks - Create single block
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { ausbildungBlocks, profiles } from '@/db/migrations/schemas/schema';
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
    const month = now.getMonth() + 1; // 0-indexed

    // German school year starts in August
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

// GET /api/trainee/school/blocks?traineeId=...&schuljahr=...&year=...
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const traineeId = searchParams.get('traineeId');
        const schuljahr = searchParams.get('schuljahr');
        const year = searchParams.get('year');
        const ausbildungsjahr = searchParams.get('ausbildungsjahr');

        if (!traineeId) {
            return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });
        }

        // Build query conditions
        const conditions = [eq(ausbildungBlocks.traineeId, traineeId as any)];

        if (schuljahr) {
            conditions.push(eq(ausbildungBlocks.schuljahr, schuljahr));
        }

        if (year) {
            conditions.push(eq(ausbildungBlocks.year, parseInt(year, 10)));
        }

        if (ausbildungsjahr) {
            conditions.push(eq(ausbildungBlocks.ausbildungsjahr, parseInt(ausbildungsjahr, 10)));
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
        console.error('List blocks error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// POST /api/trainee/school/blocks
// Body: { traineeId, schuljahr?, ausbildungsjahr?, calendarWeek, year, startDate, endDate, blockType, blockNumber?, title?, notes?, isPersonal?, examSubType?, description?, inviteeEmails? }
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            traineeId,
            schuljahr,
            ausbildungsjahr,
            calendarWeek,
            year,
            startDate,
            endDate,
            blockType,
            blockNumber,
            title,
            notes,
            isPersonal = false,
            // New fields
            examSubType,
            description,
            inviteeEmails,
        } = body;

        // Validation
        if (!traineeId) return NextResponse.json({ error: 'traineeId required' }, { status: 400 });
        if (!calendarWeek || calendarWeek < 1 || calendarWeek > 53) {
            return NextResponse.json({ error: 'Valid calendarWeek (1-53) required' }, { status: 400 });
        }
        if (!year) return NextResponse.json({ error: 'year required' }, { status: 400 });
        if (!startDate) return NextResponse.json({ error: 'startDate required' }, { status: 400 });
        if (!endDate) return NextResponse.json({ error: 'endDate required' }, { status: 400 });

        // Updated validation for new block types
        const validBlockTypes = ['SCHOOL', 'COMPANY', 'HOLIDAY', 'EXAM', 'PERSONAL', 'SONSTIGES', 'TRAINER_BLOCKER'];
        if (!blockType || !validBlockTypes.includes(blockType)) {
            return NextResponse.json({ error: `Valid blockType required (${validBlockTypes.join(', ')})` }, { status: 400 });
        }

        // Validate SONSTIGES requires description
        if (blockType === 'SONSTIGES' && !description) {
            return NextResponse.json({ error: 'Description required for SONSTIGES block type' }, { status: 400 });
        }

        const organizationId = await getUserOrgId(traineeId);

        // Get trainee profile to calculate Ausbildungsjahr if not provided
        let calculatedAusbildungsjahr = ausbildungsjahr;
        let calculatedSchuljahr = schuljahr;

        if (!calculatedAusbildungsjahr || !calculatedSchuljahr) {
            const [trainee] = await db
                .select({ startOfTrainingDate: profiles.startOfTrainingDate })
                .from(profiles)
                .where(eq(profiles.id, traineeId));

            if (trainee?.startOfTrainingDate && !calculatedAusbildungsjahr) {
                calculatedAusbildungsjahr = calculateAusbildungsjahr(trainee.startOfTrainingDate);
            } else if (!calculatedAusbildungsjahr) {
                calculatedAusbildungsjahr = 1; // Default to year 1
            }

            if (!calculatedSchuljahr) {
                calculatedSchuljahr = getCurrentSchuljahr();
            }
        }

        const [row] = await db
            .insert(ausbildungBlocks)
            .values({
                traineeId: traineeId as any,
                organizationId,
                schuljahr: calculatedSchuljahr,
                ausbildungsjahr: calculatedAusbildungsjahr,
                calendarWeek,
                year,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                blockType,
                blockNumber: blockNumber || null,
                title: title || null,
                notes: notes || null,
                isPersonal,
                // New fields
                examSubType: examSubType || null,
                description: description || null,
                inviteeEmails: inviteeEmails || null,
            })
            .returning();

        // TODO: Send email invitations if inviteeEmails is provided
        // This will be handled by the email service module

        return NextResponse.json({ id: row.id, block: row }, { status: 201 });
    } catch (e) {
        console.error('Create block error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

