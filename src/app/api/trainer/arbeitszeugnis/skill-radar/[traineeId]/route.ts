import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import db from '@/db';
import {
    activityReports,
    activityReportUseCaseEntries,
    trainingUseCases,
    trainingComponents,
    profiles
} from '@/db/migrations/schemas/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

/**
 * GET /api/trainer/arbeitszeugnis/skill-radar/[traineeId]
 * 
 * Skill-Radar: Returns data for radar chart visualization
 * showing competency levels per IHK component.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ traineeId: string }> }
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { traineeId } = await params;
        const { searchParams } = new URL(request.url);
        const ausbildungsjahr = parseInt(searchParams.get('ausbildungsjahr') || '1');
        const customStartDate = searchParams.get('startDate');
        const customEndDate = searchParams.get('endDate');

        // Get trainee profile
        const traineeProfile = await db
            .select({
                startDate: profiles.startOfTrainingDate,
                fullName: profiles.fullName,
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
            const startOfTraining = traineeProfile[0]?.startDate || new Date('2025-08-01');

            yearStart = new Date(startOfTraining);
            yearStart.setFullYear(yearStart.getFullYear() + (ausbildungsjahr - 1));

            yearEnd = new Date(yearStart);
            yearEnd.setFullYear(yearEnd.getFullYear() + 1);
            yearEnd.setDate(yearEnd.getDate() - 1);
        }

        // Fetch graded entries grouped by component
        const gradedEntries = await db
            .select({
                trainerGrade: activityReportUseCaseEntries.trainerGrade,
                componentCode: trainingComponents.code,
                componentTitle: trainingComponents.title,
                componentOrderIndex: trainingComponents.orderIndex,
            })
            .from(activityReportUseCaseEntries)
            .innerJoin(activityReports, eq(activityReportUseCaseEntries.reportId, activityReports.id))
            .innerJoin(trainingUseCases, eq(activityReportUseCaseEntries.useCaseId, trainingUseCases.id))
            .innerJoin(trainingComponents, eq(trainingUseCases.componentId, trainingComponents.id))
            .where(
                and(
                    eq(activityReports.traineeId, traineeId),
                    eq(activityReports.status, 'APPROVED'),
                    gte(activityReports.periodStart, yearStart),
                    lte(activityReports.periodStart, yearEnd)
                )
            );

        // Group and calculate averages per component
        const componentMap = new Map<string, {
            code: string;
            title: string;
            orderIndex: number;
            gradeSum: number;
            gradedCount: number;
        }>();

        for (const entry of gradedEntries) {
            const key = entry.componentCode;

            if (!componentMap.has(key)) {
                componentMap.set(key, {
                    code: entry.componentCode,
                    title: entry.componentTitle,
                    orderIndex: entry.componentOrderIndex,
                    gradeSum: 0,
                    gradedCount: 0,
                });
            }

            if (entry.trainerGrade) {
                const comp = componentMap.get(key)!;
                comp.gradedCount++;
                comp.gradeSum += parseInt(entry.trainerGrade);
            }
        }

        // Convert to radar chart format
        // For radar charts, we invert the scale (1 is best = 6 on chart, 6 is worst = 1 on chart)
        // This makes the chart intuitive (larger area = better performance)
        const radarData = Array.from(componentMap.values())
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map(comp => {
                const avgGrade = comp.gradedCount > 0
                    ? comp.gradeSum / comp.gradedCount
                    : null;

                // Invert scale for radar visualization (6 - grade + 1)
                // Grade 1 (best) → 6 points, Grade 6 (worst) → 1 point
                const radarValue = avgGrade !== null ? 7 - avgGrade : null;

                // Shorter label for radar chart
                const shortLabel = shortenComponentTitle(comp.title);

                return {
                    component: comp.code,
                    fullTitle: comp.title,
                    label: shortLabel,
                    grade: avgGrade !== null ? Math.round(avgGrade * 100) / 100 : null,
                    radarValue: radarValue !== null ? Math.round(radarValue * 100) / 100 : null,
                    gradedCount: comp.gradedCount,
                };
            });

        // Calculate overall stats
        const gradedComponents = radarData.filter(r => r.grade !== null);
        const overallAverage = gradedComponents.length > 0
            ? gradedComponents.reduce((sum, r) => sum + (r.grade || 0), 0) / gradedComponents.length
            : null;

        return NextResponse.json({
            traineeId,
            traineeName: traineeProfile[0]?.fullName || 'Unknown',
            ausbildungsjahr,
            radarData,
            stats: {
                overallAverage: overallAverage !== null ? Math.round(overallAverage * 100) / 100 : null,
                totalComponents: radarData.length,
                gradedComponents: gradedComponents.length,
                shorteningEligible: overallAverage !== null && overallAverage < 2.45,
            },
            // Chart configuration hints for frontend
            chartConfig: {
                maxValue: 6,
                minValue: 1,
                levels: 6,
                labelOffset: 1.2,
                colors: {
                    excellent: '#22c55e', // Grade 1-2
                    good: '#84cc16',      // Grade 2-3
                    satisfactory: '#eab308', // Grade 3-4
                    sufficient: '#f97316',   // Grade 4-5
                    poor: '#ef4444',         // Grade 5-6
                },
            },
        });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error generating skill radar data:', error);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

/**
 * Shorten component title for radar chart labels
 */
function shortenComponentTitle(title: string): string {
    // Common abbreviations for German training components
    const abbreviations: Record<string, string> = {
        'Planen, Vorbereiten und Durchführen': 'Planung',
        'Informieren und Beraten': 'Beratung',
        'Beurteilen marktgängiger': 'Marktanalyse',
        'Entwickeln, Erstellen und Betreuen': 'Entwicklung',
        'Durchführen und Dokumentieren von qualitätssichernden': 'QS',
        'Umsetzen, Integrieren und Prüfen von Maßnahmen zur IT-Sicherheit': 'IT-Sicherheit',
        'Erbringen der Leistungen': 'Leistung',
        'Betreiben von IT-Systemen': 'IT-Betrieb',
        'Inbetriebnehmen von Speicherlösungen': 'Speicher',
        'Programmieren': 'Programmierung',
        'Konzipieren und Umsetzen von kundenspezifischen': 'Anwendungsentw.',
        'Sicherstellen der Qualität': 'Qualität',
        'Vernetztes Zusammenarbeiten': 'Teamarbeit',
        'Berufsbildung, Arbeits- und Tarifrecht': 'Arbeitsrecht',
        'Aufbau und Organisation': 'Organisation',
        'Sicherheit und Gesundheitsschutz': 'Arbeitssicherheit',
        'Umweltschutz': 'Umwelt',
    };

    for (const [pattern, abbrev] of Object.entries(abbreviations)) {
        if (title.includes(pattern)) {
            return abbrev;
        }
    }

    // Fallback: first 15 chars
    return title.length > 15 ? title.substring(0, 12) + '...' : title;
}
