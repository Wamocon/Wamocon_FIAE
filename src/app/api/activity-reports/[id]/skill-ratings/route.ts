import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { activityReports, profiles } from '@/db/migrations/schemas/schema';
import { apiCache } from '@/lib/api-cache';

// PATCH: Update skill self-ratings on an existing activity report
// Allows trainee to fill/update skill self-ratings on any of their own reports
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { userId, skillSelfRatings } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    if (!skillSelfRatings || typeof skillSelfRatings !== 'object') {
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
    const [report] = await db
      .select()
      .from(activityReports)
      .where(eq(activityReports.id, id as any));

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (String(report.traineeId) !== userId) {
      return NextResponse.json(
        { error: 'Zugriff verweigert' },
        { status: 403 }
      );
    }

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

    // Update skill self-ratings
    await db
      .update(activityReports)
      .set({
        skillSelfRatings,
        updatedAt: new Date(),
      })
      .where(eq(activityReports.id, id as any));

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
