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
import { executeAction, ActionType } from '@/lib/hai/actions';
import { requireProPlan, toHaiRole } from '@/lib/auth-helpers';
import { isErrorResponse, requireUser } from '@/lib/auth/session';

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
        // The person is the session, a userId in the query is ignored
        const me = await requireUser(req);
        if (isErrorResponse(me)) return me;
        const userId = me.id;

        if (!(await requireProPlan(userId))) {
            return NextResponse.json(
                { error: 'HAI.ai is only available with a PRO subscription.' },
                { status: 403 }
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
        // The person and the role come from the session, never from the query
        const me = await requireUser(req);
        if (isErrorResponse(me)) return me;

        if (!(await requireProPlan(me.id))) {
            return NextResponse.json({ error: 'HAI.ai is only available with a PRO subscription.' }, { status: 403 });
        }

        const userRole = me.role;

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
