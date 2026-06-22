/**
 * HAI.ai Action API Route
 *
 * Endpoint for executing platform actions on behalf of the user.
 * This enables HAI to perform write operations (create, update, delete).
 *
 * POST /api/hai/action - Execute an action
 *
 * Request body:
 * {
 *   actionType: ActionType;
 *   parameters: Record<string, unknown>;
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';
import { executeAction, ActionType } from '@/lib/hai/actions';
import { requireProPlan, toHaiRole } from '@/lib/auth-helpers';

// ============================================================================
// TYPES
// ============================================================================

interface ActionRequestBody {
    actionType: ActionType;
    parameters: Record<string, unknown>;
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * POST - Execute an action
 */
export async function POST(req: NextRequest) {
    try {
        // Get user ID from request
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json(
                { error: 'Nicht authentifiziert. Bitte melde dich an.' },
                { status: 401 }
            );
        }

        if (!(await requireProPlan(userId))) {
            return NextResponse.json(
                { error: 'HAI.ai is only available with a PRO subscription.' },
                { status: 403 }
            );
        }

        // Verify user exists
        const user = await db
            .select({ id: profiles.id, role: profiles.role })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        if (user.length === 0) {
            return NextResponse.json(
                { error: 'Benutzer nicht gefunden.' },
                { status: 404 }
            );
        }

        // Parse request body
        const body: ActionRequestBody = await req.json();
        const { actionType, parameters } = body;

        // Validate action type
        if (!actionType || typeof actionType !== 'string') {
            return NextResponse.json(
                { error: 'Ungültiger Aktionstyp.' },
                { status: 400 }
            );
        }

        // Execute the action
        const result = await executeAction(actionType, parameters || {}, userId);

        // Return result
        if (result.success) {
            return NextResponse.json({
                success: true,
                message: result.message,
                data: result.data,
            });
        } else {
            return NextResponse.json(
                {
                    success: false,
                    error: result.message,
                    details: result.error,
                },
                { status: 400 }
            );
        }
    } catch (error) {
        console.error('HAI.ai action API error:', error);
        return NextResponse.json(
            { error: 'Ein interner Fehler ist aufgetreten beim Ausführen der Aktion.' },
            { status: 500 }
        );
    }
}

/**
 * GET - Get available actions for user
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }

        if (!(await requireProPlan(userId))) {
            return NextResponse.json({ error: 'HAI.ai is only available with a PRO subscription.' }, { status: 403 });
        }

        // Get user role
        const user = await db
            .select({ role: profiles.role })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        if (user.length === 0) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const userRole = user[0].role;

        // Define available actions based on role
        const traineeActions: ActionType[] = [
            'create_activity_report',
            'submit_activity_report',
            'complete_enabler',
            'submit_quiz',
            'mark_notification_read',
            'upload_document',
        ];

        const trainerActions: ActionType[] = [
            ...traineeActions,
            'approve_submission',
            'reject_submission',
            'approve_report',
            'reject_report',
            'grade_quiz',
        ];

        const availableActions =
            toHaiRole(userRole) === 'TRAINER' ? trainerActions : traineeActions;

        return NextResponse.json({
            success: true,
            userRole,
            availableActions,
        });
    } catch (error) {
        console.error('HAI.ai action list error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
