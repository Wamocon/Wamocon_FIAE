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
 * GET /api/trainee/arbeitszeugnis/stats
 * 
 * Secure endpoint for trainees to fetch their own aggregated statistics and skill radar data.
 * Does NOT accept a traineeId parameter; strictly uses the session user's ID.
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const traineeId = user.id;
        const { searchParams } = new URL(request.url);
        const ausbildungsjahr = parseInt(searchParams.get('ausbildungsjahr') || '1');

        // Get trainee profile & start date
        const traineeProfile = await db
            .select({
                startDate: profiles.startOfTrainingDate,
                fullName: profiles.fullName,
            })
            .from(profiles)
            .where(eq(profiles.id, traineeId))
            .limit(1);

        const startOfTraining = traineeProfile[0]?.startDate || new Date('2025-08-01');

        // Calculate year boundaries
        const yearStart = new Date(startOfTraining);
        yearStart.setFullYear(yearStart.getFullYear() + (ausbildungsjahr - 1));

        const yearEnd = new Date(yearStart);
        yearEnd.setFullYear(yearEnd.getFullYear() + 1);
        yearEnd.setDate(yearEnd.getDate() - 1);

        // Fetch all graded use case entries
        const gradedEntries = await db
            .select({
                trainerGrade: activityReportUseCaseEntries.trainerGrade,
                actualHours: activityReportUseCaseEntries.actualHours,
                useCaseLetter: trainingUseCases.letter,
                useCaseDescription: trainingUseCases.description,
                componentId: trainingComponents.id,
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
            )
            .orderBy(trainingComponents.orderIndex, trainingUseCases.orderIndex);

        // Group by component
        const componentMap = new Map<string, {
            componentId: string;
            componentCode: string;
            componentTitle: string;
            orderIndex: number;
            totalHours: number;
            gradedCount: number;
            gradeSum: number;
        }>();

        for (const entry of gradedEntries) {
            const key = entry.componentCode;

            if (!componentMap.has(key)) {
                componentMap.set(key, {
                    componentId: entry.componentId,
                    componentCode: entry.componentCode,
                    componentTitle: entry.componentTitle,
                    orderIndex: entry.componentOrderIndex,
                    totalHours: 0,
                    gradedCount: 0,
                    gradeSum: 0,
                });
            }

            const comp = componentMap.get(key)!;
            comp.totalHours += entry.actualHours;

            if (entry.trainerGrade) {
                comp.gradedCount++;
                comp.gradeSum += parseInt(entry.trainerGrade);
            }
        }

        // Process Component Data & Radar Data
        const processedComponents = Array.from(componentMap.values())
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map(comp => {
                const avgGrade = comp.gradedCount > 0
                    ? comp.gradeSum / comp.gradedCount
                    : null;

                // Radar Value: Inverted scale (1 is best/max radius)
                // We map 1..6 to 6..1
                const radarValue = avgGrade !== null ? 7 - avgGrade : null;

                return {
                    ...comp,
                    averageGrade: avgGrade,
                    finalGrade: avgGrade !== null ? Math.round(avgGrade) : null,
                    radarValue: radarValue,
                    shortLabel: shortenComponentTitle(comp.componentTitle)
                };
            });

        // Calculate Overall Average
        const gradedComps = processedComponents.filter(c => c.averageGrade !== null);
        const overallAverage = gradedComps.length > 0
            ? gradedComps.reduce((sum, c) => sum + (c.averageGrade || 0), 0) / gradedComps.length
            : null;

        return NextResponse.json({
            aggregatedData: {
                traineeId,
                traineeName: traineeProfile[0]?.fullName,
                ausbildungsjahr,
                overallAverage: overallAverage !== null ? Math.round(overallAverage * 100) / 100 : null,
                shorteningEligible: overallAverage !== null && overallAverage < 2.45,
                components: processedComponents.map(c => ({
                    componentId: c.componentId,
                    componentCode: c.componentCode,
                    componentTitle: c.componentTitle,
                    totalHours: c.totalHours,
                    gradedCount: c.gradedCount,
                    // totalUseCases: ... // We skipped fetching total counts for simplicity/performance in this view
                    averageGrade: c.averageGrade !== null ? Math.round(c.averageGrade * 100) / 100 : null,
                    finalGrade: c.finalGrade
                }))
            },
            radarData: {
                radarData: processedComponents.map(c => ({
                    component: c.componentCode,
                    fullTitle: c.componentTitle,
                    label: c.shortLabel,
                    grade: c.averageGrade !== null ? Math.round(c.averageGrade * 100) / 100 : null,
                    radarValue: c.radarValue !== null ? Math.round(c.radarValue * 100) / 100 : null,
                    gradedCount: c.gradedCount
                }))
            }
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in trainee stats API:', error);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

function shortenComponentTitle(title: string): string {
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
    return title.length > 15 ? title.substring(0, 12) + '...' : title;
}
