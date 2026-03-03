import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { gradeEditHistory, profiles } from '@/db/migrations/schemas/schema';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/grade-edit-history?entityType=...&entityId=...
 * 
 * Returns the audit trail of grade changes for a specific entity.
 * Used by trainers to view the history of grade modifications.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const entityType = searchParams.get('entityType');
        const entityId = searchParams.get('entityId');

        if (!entityType || !entityId) {
            return NextResponse.json(
                { error: 'entityType and entityId are required' },
                { status: 400 }
            );
        }

        const history = await db
            .select({
                id: gradeEditHistory.id,
                entityType: gradeEditHistory.entityType,
                entityId: gradeEditHistory.entityId,
                fieldName: gradeEditHistory.fieldName,
                oldValue: gradeEditHistory.oldValue,
                newValue: gradeEditHistory.newValue,
                changedBy: gradeEditHistory.changedBy,
                changeReason: gradeEditHistory.changeReason,
                changedAt: gradeEditHistory.createdAt,
                changerName: profiles.fullName,
            })
            .from(gradeEditHistory)
            .leftJoin(profiles, eq(gradeEditHistory.changedBy, profiles.id))
            .where(
                and(
                    eq(gradeEditHistory.entityType, entityType),
                    eq(gradeEditHistory.entityId, entityId)
                )
            )
            .orderBy(desc(gradeEditHistory.createdAt));

        return NextResponse.json({ history });
    } catch (error) {
        console.error('Error fetching grade edit history:', error);
        return NextResponse.json(
            { error: 'Interner Serverfehler' },
            { status: 500 }
        );
    }
}
