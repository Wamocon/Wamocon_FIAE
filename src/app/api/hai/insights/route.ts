/**
 * HAI.ai Proactive Insights API Route
 *
 * Endpoint for getting proactive insights and reminders for users.
 * This enables HAI to be proactive, not just reactive.
 *
 * GET /api/hai/insights - Get personalized insights
 */

import { NextRequest, NextResponse } from 'next/server';
import { runProactiveChecks } from '@/lib/hai/proactive';
import { requireProPlan } from '@/lib/auth-helpers';
import { isErrorResponse, requireUser } from '@/lib/auth/session';

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * GET - Get proactive insights for user
 */
export async function GET(req: NextRequest) {
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

        // Run proactive checks
        const insights = await runProactiveChecks(userId);

        return NextResponse.json({
            success: true,
            insights,
            count: insights.length,
        });
    } catch (error) {
        console.error('HAI.ai insights API error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
