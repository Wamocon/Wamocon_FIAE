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
import { requireCatalogScope } from '@/lib/catalog/scope';

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

        // The occupation the person works in (x-catalog): a report and a course
        // belong to one occupation, so the reminders follow it. A scope that
        // cannot be read (also an occupation the person does not have) leaves it
        // open, the checks then use the default occupation of a trainee. A trainer
        // who chose no occupation keeps the counts of all occupations of the
        // organization, as before.
        const catalogScope = await requireCatalogScope(me, req);
        const catalogId =
            catalogScope instanceof Response ||
            (me.isTrainerLevel && !catalogScope.selected)
                ? null
                : catalogScope.activeCatalogId;

        // Run proactive checks
        const insights = await runProactiveChecks(userId, catalogId);

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
