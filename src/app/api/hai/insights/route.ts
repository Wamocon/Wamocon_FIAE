/**
 * HAI.ai Proactive Insights API Route
 *
 * Endpoint for getting proactive insights and reminders for users.
 * This enables HAI to be proactive, not just reactive.
 *
 * GET /api/hai/insights - Get personalized insights
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';
import { runProactiveChecks } from '@/lib/hai/proactive';
import { requireProPlan } from '@/lib/auth-helpers';

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * GET - Get proactive insights for user
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
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
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
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
