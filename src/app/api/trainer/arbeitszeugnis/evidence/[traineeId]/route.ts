import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  activityReports,
  activityReportEntries,
  activityReportUseCaseEntries,
  trainingUseCases,
  trainingComponents,
  profiles,
} from '@/db/migrations/schemas/schema';
import { eq, and, gte, lte, isNotNull, inArray } from 'drizzle-orm';
import { getTrainingYearDateRange } from '@/lib/ausbildung/duration';

/**
 * GET /api/trainer/arbeitszeugnis/evidence/[traineeId]
 *
 * Evidence-Generator: Extracts project highlights from activity reports
 * to substantiate grades in the certificate.
 *
 * Scans betriebliche_taetigkeit text for notable mentions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ traineeId: string }> }
) {
  try {
    const { traineeId } = await params;

    if (!traineeId) {
      return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const ausbildungsjahr = parseInt(
      searchParams.get('ausbildungsjahr') || '1'
    );
    const customStartDate = searchParams.get('startDate');
    const customEndDate = searchParams.get('endDate');

    // Get trainee start date
    const traineeProfile = await db
      .select({
        startDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
      })
      .from(profiles)
      .where(eq(profiles.id, traineeId))
      .limit(1);

    let yearStart: Date;
    let yearEnd: Date;

    if (customStartDate && customEndDate) {
      yearStart = new Date(customStartDate);
      yearEnd = new Date(customEndDate);
      if (yearEnd.getUTCHours() === 0 && yearEnd.getUTCMinutes() === 0) {
        yearEnd.setUTCHours(23, 59, 59, 999);
      }
    } else {
      const startOfTraining =
        traineeProfile[0]?.startDate || new Date('2025-08-01');
      const range = getTrainingYearDateRange(
        startOfTraining,
        ausbildungsjahr,
        traineeProfile[0]?.ausbildungDurationYears
      );
      yearStart = range.startDate;
      yearEnd = range.endDate;
    }

    // Fetch all activity reports with their entries (betrieblicheTaetigkeit is in entries table)
    const reportData = await db
      .select({
        reportId: activityReports.id,
        periodStart: activityReports.periodStart,
        periodEnd: activityReports.periodEnd,
        betrieblicheTaetigkeit: activityReportEntries.betrieblicheTaetigkeit,
        rahmenplanRef: activityReportEntries.rahmenplanRef,
        unterweisungenThemen: activityReportEntries.unterweisungenThemen,
      })
      .from(activityReports)
      .innerJoin(
        activityReportEntries,
        eq(activityReportEntries.reportId, activityReports.id)
      )
      .where(
        and(
          eq(activityReports.traineeId, traineeId),
          eq(activityReports.status, 'APPROVED'),
          gte(activityReports.periodStart, yearStart),
          lte(activityReports.periodStart, yearEnd),
          isNotNull(activityReportEntries.betrieblicheTaetigkeit)
        )
      )
      .orderBy(activityReports.periodStart);

    // Extract highlights using keyword detection
    const projectKeywords = [
      'projekt',
      'entwickelt',
      'implementiert',
      'erstellt',
      'programmiert',
      'designed',
      'konzipiert',
      'aufgebaut',
      'optimiert',
      'automatisiert',
      'migriert',
      'deploy',
      'released',
      'launched',
      'abgeschlossen',
      'team',
      'präsentation',
      'workshop',
      'schulung',
      'kunde',
      'api',
      'database',
      'frontend',
      'backend',
      'system',
      'anwendung',
    ];

    const highlights: Array<{
      id: string;
      date: string;
      weekRange: string;
      text: string;
      category: 'project' | 'skill' | 'achievement';
      relevantComponent?: string;
      grade?: number;
    }> = [];

    for (const report of reportData) {
      const text = report.betrieblicheTaetigkeit?.toLowerCase() || '';
      const matchCount = projectKeywords.filter(kw => text.includes(kw)).length;

      // Include if at least 2 keywords match (likely a notable activity)
      if (matchCount >= 2 && report.betrieblicheTaetigkeit) {
        const weekRange = formatWeekRange(report.periodStart, report.periodEnd);

        highlights.push({
          id: `proj-${highlights.length}`, // Simple unique ID
          date: report.periodStart?.toISOString() || '',
          weekRange,
          text: report.betrieblicheTaetigkeit,
          category: categorizeHighlight(report.betrieblicheTaetigkeit),
          relevantComponent: report.rahmenplanRef || undefined,
        });
      }
    }

    // Get use case entries with high grades (1 or 2) as additional evidence
    const excellentEntries = await db
      .select({
        entryId: activityReportUseCaseEntries.id,
        actualHours: activityReportUseCaseEntries.actualHours,
        trainerGrade: activityReportUseCaseEntries.trainerGrade,
        useCaseDescription: trainingUseCases.description,
        componentTitle: trainingComponents.title,
        periodStart: activityReports.periodStart,
      })
      .from(activityReportUseCaseEntries)
      .innerJoin(
        activityReports,
        eq(activityReportUseCaseEntries.reportId, activityReports.id)
      )
      .innerJoin(
        trainingUseCases,
        eq(activityReportUseCaseEntries.useCaseId, trainingUseCases.id)
      )
      .innerJoin(
        trainingComponents,
        eq(trainingUseCases.componentId, trainingComponents.id)
      )
      .where(
        and(
          eq(activityReports.traineeId, traineeId),
          eq(activityReports.status, 'APPROVED'),
          gte(activityReports.periodStart, yearStart),
          lte(activityReports.periodStart, yearEnd),
          inArray(activityReportUseCaseEntries.trainerGrade, ['1', '2'])
        )
      );

    // Add excellent grade entries as achievements
    for (const entry of excellentEntries) {
      highlights.push({
        id: `ach-${entry.entryId}`,
        date: entry.periodStart?.toISOString() || '',
        weekRange: entry.periodStart
          ? formatWeekRange(entry.periodStart, entry.periodStart)
          : '',
        text: `${entry.componentTitle}: ${entry.useCaseDescription}`,
        category: 'achievement',
        relevantComponent: entry.componentTitle,
        grade: parseFloat(entry.trainerGrade ?? '0'), // Include grade for frontend display
      });
    }

    // Sort by date and limit to top 15
    const sortedHighlights = highlights
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 15);

    return NextResponse.json({
      traineeId,
      ausbildungsjahr,
      highlights: sortedHighlights,
      totalReportsScanned: reportData.length,
      highlightsFound: sortedHighlights.length,
    });
  } catch (error: unknown) {
    console.error('Error generating evidence:', error);
    return NextResponse.json({ error: 'Interner Serverfehler beim Erstellen der Leistungsnachweise' }, { status: 500 });
  }
}

function formatWeekRange(start: Date | null, end: Date | null): string {
  if (!start) return '';
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  };
  const startStr = start.toLocaleDateString('de-DE', opts);
  const endStr = end ? end.toLocaleDateString('de-DE', opts) : startStr;
  return `${startStr} - ${endStr}`;
}

function categorizeHighlight(
  text: string
): 'project' | 'skill' | 'achievement' {
  const lowerText = text.toLowerCase();
  if (
    lowerText.includes('projekt') ||
    lowerText.includes('entwickelt') ||
    lowerText.includes('implementiert')
  ) {
    return 'project';
  }
  if (
    lowerText.includes('gelernt') ||
    lowerText.includes('schulung') ||
    lowerText.includes('workshop')
  ) {
    return 'skill';
  }
  return 'achievement';
}
