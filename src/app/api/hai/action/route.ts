/**
 * HAI.ai Action API Route
 *
 * Endpoint for executing platform actions on behalf of the user.
 * This enables HAI to perform write operations (create, update, delete).
 *
 * The chat pipeline only PROPOSES a write. This route executes it, and only
 * after the person has explicitly confirmed it (the confirmation card sends
 * `confirmed: true`). Everything is checked again here: the session decides
 * who acts, the role must fit the action type, and the records must belong to
 * the person or to the trainer's organization and occupation (see
 * executeAction). The proposal itself carries no authority.
 *
 * POST /api/hai/action - Execute a confirmed action
 *
 * Request body:
 * {
 *   actionType: ActionType;
 *   parameters: Record<string, unknown>;
 *   confirmed: true;
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeAction, type ActionFailureCode } from '@/lib/hai/actions';
import { actionsForRole, isWriteAction } from '@/lib/hai/actionPolicy';
import { requireProPlan } from '@/lib/auth-helpers';
import { isErrorResponse, requireUser } from '@/lib/auth/session';

// ============================================================================
// TYPES
// ============================================================================

/** HTTP status of a failed action, a failure without a code stays a 400. */
const STATUS_BY_CODE: Record<ActionFailureCode, number> = {
    invalid: 400,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    unavailable: 503,
    error: 500,
};

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * POST - Execute a confirmed action
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
        let body: Record<string, unknown> | null = null;
        try {
            const parsed: unknown = await req.json();
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                body = parsed as Record<string, unknown>;
            }
        } catch {
            body = null;
        }
        if (!body) {
            return NextResponse.json(
                { error: 'Ungültige Anfrage.' },
                { status: 400 }
            );
        }
        const { actionType, parameters, confirmed } = body;

        // Only action types on the list are executed
        if (!isWriteAction(actionType)) {
            return NextResponse.json(
                { error: 'Ungültiger Aktionstyp.' },
                { status: 400 }
            );
        }

        // A write needs the explicit confirmation of the person
        if (confirmed !== true) {
            return NextResponse.json(
                { error: 'Die Aktion muss ausdrücklich bestätigt werden.' },
                { status: 400 }
            );
        }

        // Role, responsibility and parameters are checked in executeAction
        const result = await executeAction(
            actionType,
            (parameters ?? {}) as Record<string, unknown>,
            me,
            req
        );

        // Return result, never raw error details
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
                { status: result.code ? STATUS_BY_CODE[result.code] : 400 }
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

        // Trainers only get trainer actions, trainees only trainee actions
        const availableActions = actionsForRole(
            me.isTrainerLevel ? 'TRAINER' : 'TRAINEE'
        );

        return NextResponse.json({
            success: true,
            userRole: me.role,
            availableActions,
        });
    } catch (error) {
        console.error('HAI.ai action list error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
