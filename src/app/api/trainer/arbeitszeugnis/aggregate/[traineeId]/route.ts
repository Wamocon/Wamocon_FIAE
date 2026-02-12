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
 * GET /api/trainer/arbeitszeugnis/aggregate/[traineeId]
 * 
 * Aggregates grades from Tätigkeitsnachweis (activity reports) by IHK-ARP component.
 * This is the core data source for certificate generation.
 * 
 * Query params:
 * - ausbildungsjahr: Training year (1, 2, or 3)
 * 
 * Returns:
 * - Components grouped by IHK order with average grades
 * - Overall average for shortening indicator
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

        let yearStart: Date;
        let yearEnd: Date;

        if (customStartDate && customEndDate) {
            yearStart = new Date(customStartDate);
            yearEnd = new Date(customEndDate);
            // Ensure end date covers the full day if time is 00:00:00
            if (yearEnd.getUTCHours() === 0 && yearEnd.getUTCMinutes() === 0) {
                yearEnd.setUTCHours(23, 59, 59, 999);
            }
        } else {
            // Calculate date range for the training year
            // Training typically starts August 1st
            const traineeProfile = await db
                .select({ startDate: profiles.startOfTrainingDate })
                .from(profiles)
                .where(eq(profiles.id, traineeId))
                .limit(1);

            const startOfTraining = traineeProfile[0]?.startDate || new Date('2025-08-01');

            // Calculate year boundaries
            yearStart = new Date(startOfTraining);
            yearStart.setFullYear(yearStart.getFullYear() + (ausbildungsjahr - 1));

            yearEnd = new Date(yearStart);
            yearEnd.setFullYear(yearEnd.getFullYear() + 1);
            yearEnd.setDate(yearEnd.getDate() - 1);
        }

        // Fetch all graded use case entries for the trainee within the date range
        const gradedEntries = await db
            .select({
                entryId: activityReportUseCaseEntries.id,
                trainerGrade: activityReportUseCaseEntries.trainerGrade,
                actualHours: activityReportUseCaseEntries.actualHours,
                isGradeApproved: activityReportUseCaseEntries.isGradeApproved,
                useCaseId: trainingUseCases.id,
                useCaseLetter: trainingUseCases.letter,
                useCaseDescription: trainingUseCases.description,
                componentId: trainingComponents.id,
                componentCode: trainingComponents.code,
                componentTitle: trainingComponents.title,
                componentOrderIndex: trainingComponents.orderIndex,
                reportPeriodStart: activityReports.periodStart,
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

        // Group by component and calculate averages
        const componentMap = new Map<string, {
            componentId: string;
            componentCode: string;
            componentTitle: string;
            orderIndex: number;
            useCases: Array<{
                useCaseId: string;
                letter: string;
                description: string;
                grade: string | null;
                hours: number;
                isApproved: boolean;
            }>;
            totalHours: number;
            gradedCount: number;
            gradeSum: number;
        }>();

        for (const entry of gradedEntries) {
            const key = entry.componentId;

            if (!componentMap.has(key)) {
                componentMap.set(key, {
                    componentId: entry.componentId,
                    componentCode: entry.componentCode,
                    componentTitle: entry.componentTitle,
                    orderIndex: entry.componentOrderIndex,
                    useCases: [],
                    totalHours: 0,
                    gradedCount: 0,
                    gradeSum: 0,
                });
            }

            const comp = componentMap.get(key)!;
            comp.useCases.push({
                useCaseId: entry.useCaseId,
                letter: entry.useCaseLetter,
                description: entry.useCaseDescription,
                grade: entry.trainerGrade,
                hours: entry.actualHours,
                isApproved: entry.isGradeApproved ?? false,
            });

            comp.totalHours += entry.actualHours;

            if (entry.trainerGrade) {
                comp.gradedCount++;
                comp.gradeSum += parseInt(entry.trainerGrade);
            }
        }

        // Convert to array and calculate final grades
        const components = Array.from(componentMap.values())
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map(comp => ({
                componentId: comp.componentId,
                componentCode: comp.componentCode,
                componentTitle: comp.componentTitle,
                useCases: comp.useCases,
                totalHours: comp.totalHours,
                averageGrade: comp.gradedCount > 0
                    ? Math.round((comp.gradeSum / comp.gradedCount) * 100) / 100
                    : null,
                finalGrade: comp.gradedCount > 0
                    ? Math.round(comp.gradeSum / comp.gradedCount)
                    : null,
                gradedCount: comp.gradedCount,
                totalUseCases: comp.useCases.length,
            }));

        // Calculate overall average
        const totalGradedComponents = components.filter(c => c.averageGrade !== null);
        const overallAverage = totalGradedComponents.length > 0
            ? totalGradedComponents.reduce((sum, c) => sum + (c.averageGrade || 0), 0) / totalGradedComponents.length
            : null;

        // Determine shortening eligibility (< 2.45)
        const shorteningEligible = overallAverage !== null && overallAverage < 2.45;

        // Get trainee info
        const trainee = await db
            .select({
                id: profiles.id,
                fullName: profiles.fullName,
                email: profiles.email,
                startDate: profiles.startOfTrainingDate,
            })
            .from(profiles)
            .where(eq(profiles.id, traineeId))
            .limit(1);

        return NextResponse.json({
            traineeId,
            traineeName: trainee[0]?.fullName || 'Unknown',
            traineeEmail: trainee[0]?.email || '',
            traineeStartDate: trainee[0]?.startDate,
            ausbildungsjahr,
            periodStart: yearStart.toISOString(),
            periodEnd: yearEnd.toISOString(),
            components,
            overallAverage: overallAverage !== null
                ? Math.round(overallAverage * 100) / 100
                : null,
            shorteningEligible,
            totalGradedComponents: totalGradedComponents.length,
            totalComponents: components.length,
            // IHK Grade Legend for frontend display
            gradeLegend: {
                '1': { label: 'Sehr gut', range: '92-100%', description: 'entspricht den Anforderungen in besonderem Maße' },
                '2': { label: 'Gut', range: '81-91%', description: 'entspricht den Anforderungen voll' },
                '3': { label: 'Befriedigend', range: '67-80%', description: 'entspricht den Anforderungen im Allgemeinen' },
                '4': { label: 'Ausreichend', range: '50-66%', description: 'weist Mängel auf, entspricht aber noch den Anforderungen' },
                '5': { label: 'Mangelhaft', range: '30-49%', description: 'entspricht nicht den Anforderungen, Grundkenntnisse vorhanden' },
                '6': { label: 'Ungenügend', range: '0-29%', description: 'entspricht nicht den Anforderungen, Grundkenntnisse nicht ausreichend' },
            },
        });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in arbeitszeugnis aggregate API:', error);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
