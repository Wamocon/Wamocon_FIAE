import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { activityReports } from '@/db/migrations/schemas/schema';
import { apiCache } from '@/lib/api-cache';
import { isErrorResponse } from '@/lib/auth/session';
import { readJsonObject } from '@/lib/input-limits';
import {
  loadReportForSession,
  requireTraineeSession,
} from '@/lib/auth/activity-report-access';

// PATCH: Update skill self-ratings on an existing activity report
// Allows the signed-in trainee to fill the skill self-ratings of any of their
// own reports. The person is the session, a userId in the body is ignored and
// the report of someone else is a 404. Not an action of trainer level.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireTraineeSession(request);
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await params;
    const body = await readJsonObject(request);
    if (isErrorResponse(body)) return body;
    const { skillSelfRatings } = body as Record<string, any>;

    if (
      !skillSelfRatings ||
      typeof skillSelfRatings !== 'object' ||
      Array.isArray(skillSelfRatings)
    ) {
      return NextResponse.json(
        { error: 'skillSelfRatings is required' },
        { status: 400 }
      );
    }

    // Validate grades
    const validGrades = ['1', '2', '3', '4', '5', '6'];
    for (const [area, grade] of Object.entries(skillSelfRatings)) {
      if (grade && !validGrades.includes(String(grade))) {
        return NextResponse.json(
          { error: `Ungültige Note für ${area}: ${grade}` },
          { status: 400 }
        );
      }
    }

    // Verify the report exists and belongs to this user
    const report = await loadReportForSession(session, request, id);
    if (isErrorResponse(report)) return report;

    // One-time submission: reject if already submitted
    if (
      report.skillSelfRatings &&
      typeof report.skillSelfRatings === 'object' &&
      Object.values(report.skillSelfRatings as Record<string, string>).some(
        v => v
      )
    ) {
      return NextResponse.json(
        {
          error:
            'Selbsteinschätzung wurde bereits abgegeben und kann nicht mehr geändert werden.',
        },
        { status: 409 }
      );
    }

    // Update skill self-ratings, the owner is part of the update itself
    await db
      .update(activityReports)
      .set({
        skillSelfRatings,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(activityReports.id, id as any),
          eq(activityReports.traineeId, session.id as any)
        )
      );

    apiCache.invalidate('activity_reports');

    return NextResponse.json({
      success: true,
      message: 'Kompetenz-Selbsteinschätzung gespeichert',
    });
  } catch (error: any) {
    console.error('Error in skill-ratings PATCH:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    );
  }
}
