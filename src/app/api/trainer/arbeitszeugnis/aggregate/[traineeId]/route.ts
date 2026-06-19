import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
    activityReports,
    activityReportUseCaseEntries,
    trainingUseCases,
    trainingComponents,
    profiles,
    weeklyEvaluations,
    weeklySoftskillRatings,
    mesSoftskillCriteria
} from '@/db/migrations/schemas/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

interface SoftSkillRating {
    criterionId: string;
    criterionCode: string;
    criterionName: string;
    competencyArea: string;
    trainerRating?: string | null;
    selfRating?: string | null;
    kLevel?: string | null;
    weekNumber?: number;
    year?: number;
    activityReportId?: string | null;
}

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
        const { traineeId } = await params;
        
        if (!traineeId) {
            return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });
        }

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
                traineeGrade: activityReportUseCaseEntries.traineeGrade,
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
                traineeGrade: string | null;
                trainerGrade: string | null;
                effectiveGrade: string | null; // trainerGrade is the final grade
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
            // trainerGrade is the final grade (migration 0033 merged release_grade into trainer_grade)
            const effectiveGrade = entry.trainerGrade;

            comp.useCases.push({
                useCaseId: entry.useCaseId,
                letter: entry.useCaseLetter,
                description: entry.useCaseDescription,
                traineeGrade: entry.traineeGrade,
                trainerGrade: entry.trainerGrade,
                effectiveGrade,
                hours: entry.actualHours,
                isApproved: entry.isGradeApproved ?? false,
            });

            comp.totalHours += entry.actualHours;

            if (effectiveGrade) {
                comp.gradedCount++;
                comp.gradeSum += parseInt(effectiveGrade);
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

        // === ACTIVITY REPORT KPIs ===
        // Count approved reports and total/evaluated use-case entries in the period
        let approvedReportsCount = 0;
        let totalEvaluatedUseCases = 0;
        let totalHours = 0;

        try {
            const reportStats = await db
                .select({
                    reportId: activityReports.id,
                    periodStart: activityReports.periodStart,
                    periodEnd: activityReports.periodEnd,
                    actualHours: activityReportUseCaseEntries.actualHours,
                    trainerGrade: activityReportUseCaseEntries.trainerGrade,
                })
                .from(activityReports)
                .leftJoin(
                    activityReportUseCaseEntries,
                    eq(activityReportUseCaseEntries.reportId, activityReports.id)
                )
                .where(
                    and(
                        eq(activityReports.traineeId, traineeId),
                        eq(activityReports.status, 'APPROVED'),
                        gte(activityReports.periodStart, yearStart),
                        lte(activityReports.periodStart, yearEnd)
                    )
                );

            const uniqueReportIds = new Set<string>();
            for (const row of reportStats) {
                if (row.reportId) uniqueReportIds.add(row.reportId);
                totalHours += row.actualHours || 0;
                if (row.trainerGrade) {
                    totalEvaluatedUseCases++;
                }
            }
            approvedReportsCount = uniqueReportIds.size;
        } catch (e) {
            console.error('Error fetching activity report KPIs:', e);
        }

        const avgWeeklyHours = approvedReportsCount > 0
            ? Math.round((totalHours / approvedReportsCount) * 100) / 100
            : 0;

        // Determine shortening eligibility (< 2.45)
        const shorteningEligible = overallAverage !== null && overallAverage < 2.45;

        // === SOFT SKILLS AGGREGATION ===
        // Get ALL soft skill ratings for this trainee from two sources:
        // 1. Weekly evaluations directly linked to this trainee
        // 2. Weekly evaluations linked to approved activity reports for this trainee
        
        // Query 1: Soft skills from weekly evaluations for this trainee (by ausbildungsjahr or all)
        let softSkillRatings: SoftSkillRating[] = [];
        
        try {
            // Get soft skills from weeklyEvaluations linked to this trainee
            const directRatings = await db
                .select({
                    criterionId: mesSoftskillCriteria.id,
                    criterionCode: mesSoftskillCriteria.code,
                    criterionName: mesSoftskillCriteria.name,
                    competencyArea: mesSoftskillCriteria.competencyArea,
                    kLevel: mesSoftskillCriteria.kLevel,
                    trainerRating: weeklySoftskillRatings.trainerRating,
                    selfRating: weeklySoftskillRatings.selfRating,
                    weekNumber: weeklyEvaluations.weekNumber,
                    year: weeklyEvaluations.year,
                    activityReportId: weeklyEvaluations.activityReportId,
                })
                .from(weeklySoftskillRatings)
                .innerJoin(weeklyEvaluations, eq(weeklySoftskillRatings.weeklyEvaluationId, weeklyEvaluations.id))
                .innerJoin(mesSoftskillCriteria, eq(weeklySoftskillRatings.softskillCriterionId, mesSoftskillCriteria.id))
                .where(eq(weeklyEvaluations.traineeId, traineeId));
            
            softSkillRatings = [...directRatings];
        } catch (e) {
            console.error('Error fetching direct soft skill ratings:', e);
        }
        
        // Query 2: Additionally get soft skills linked to approved activity reports (in date range)
        try {
            const linkedRatings = await db
                .select({
                    criterionId: mesSoftskillCriteria.id,
                    criterionCode: mesSoftskillCriteria.code,
                    criterionName: mesSoftskillCriteria.name,
                    competencyArea: mesSoftskillCriteria.competencyArea,
                    kLevel: mesSoftskillCriteria.kLevel,
                    trainerRating: weeklySoftskillRatings.trainerRating,
                })
                .from(weeklySoftskillRatings)
                .innerJoin(weeklyEvaluations, eq(weeklySoftskillRatings.weeklyEvaluationId, weeklyEvaluations.id))
                .innerJoin(activityReports, eq(weeklyEvaluations.activityReportId, activityReports.id))
                .innerJoin(mesSoftskillCriteria, eq(weeklySoftskillRatings.softskillCriterionId, mesSoftskillCriteria.id))
                .where(
                    and(
                        eq(activityReports.traineeId, traineeId),
                        gte(activityReports.periodStart, yearStart),
                        lte(activityReports.periodStart, yearEnd)
                    )
                );
            
            // Add linked ratings (dedup will happen when grouping)
            for (const linked of linkedRatings) {
                softSkillRatings.push({
                    ...linked,
                    selfRating: null,
                    weekNumber: 0,
                    year: 0,
                    activityReportId: null,
                });
            }
        } catch (e) {
            console.error('Error fetching linked soft skill ratings:', e);
        }

        // Performance rating to numeric conversion
        // Database stores '1', '2', '3', '4', '5', '6' as strings (performanceRating enum)
        const ratingToNumber = (rating: string | null): number | null => {
            if (!rating) return null;
            // Direct numeric string: '1', '2', etc.
            const numericValue = parseInt(rating);
            if (!isNaN(numericValue) && numericValue >= 1 && numericValue <= 6) {
                return numericValue;
            }
            // Legacy format fallback: EXCELLENT, GOOD, etc.
            const legacyMap: Record<string, number> = {
                'EXCELLENT': 1, 'GOOD': 2, 'SATISFACTORY': 3,
                'ADEQUATE': 4, 'POOR': 5, 'INSUFFICIENT': 6
            };
            return legacyMap[rating] || null;
        };

        // Group by competency area and calculate averages
        const competencyAreas = ['FACHKOMPETENZ', 'METHODENKOMPETENZ', 'SOZIALKOMPETENZ', 'PERSONALKOMPETENZ'] as const;
        const softSkillsByArea: Record<string, { ratings: number[]; criteria: Set<string> }> = {};
        
        for (const area of competencyAreas) {
            softSkillsByArea[area] = { ratings: [], criteria: new Set() };
        }

        // Also track individual criteria averages
        const criteriaMap = new Map<string, {
            code: string;
            name: string;
            area: string;
            kLevel: string | null;
            ratings: number[];
        }>();

        for (const rating of softSkillRatings) {
            // trainerRating is the final rating (migration 0033 merged release_rating into trainer_rating)
            const effectiveRatingStr = rating.trainerRating ?? null;
            const numRating = ratingToNumber(effectiveRatingStr);
            if (numRating !== null && rating.competencyArea) {
                softSkillsByArea[rating.competencyArea]?.ratings.push(numRating);
                softSkillsByArea[rating.competencyArea]?.criteria.add(rating.criterionId);

                // Track individual criteria
                if (!criteriaMap.has(rating.criterionId)) {
                    criteriaMap.set(rating.criterionId, {
                        code: rating.criterionCode,
                        name: rating.criterionName,
                        area: rating.competencyArea,
                        kLevel: rating.kLevel ?? null,
                        ratings: [],
                    });
                }
                criteriaMap.get(rating.criterionId)!.ratings.push(numRating);
            }
        }

        // Calculate area averages
        const softSkillAverages = {
            fachkompetenz: softSkillsByArea.FACHKOMPETENZ.ratings.length > 0
                ? Math.round((softSkillsByArea.FACHKOMPETENZ.ratings.reduce((a, b) => a + b, 0) / softSkillsByArea.FACHKOMPETENZ.ratings.length) * 100) / 100
                : null,
            methodenkompetenz: softSkillsByArea.METHODENKOMPETENZ.ratings.length > 0
                ? Math.round((softSkillsByArea.METHODENKOMPETENZ.ratings.reduce((a, b) => a + b, 0) / softSkillsByArea.METHODENKOMPETENZ.ratings.length) * 100) / 100
                : null,
            sozialkompetenz: softSkillsByArea.SOZIALKOMPETENZ.ratings.length > 0
                ? Math.round((softSkillsByArea.SOZIALKOMPETENZ.ratings.reduce((a, b) => a + b, 0) / softSkillsByArea.SOZIALKOMPETENZ.ratings.length) * 100) / 100
                : null,
            personalkompetenz: softSkillsByArea.PERSONALKOMPETENZ.ratings.length > 0
                ? Math.round((softSkillsByArea.PERSONALKOMPETENZ.ratings.reduce((a, b) => a + b, 0) / softSkillsByArea.PERSONALKOMPETENZ.ratings.length) * 100) / 100
                : null,
        };

        // Calculate overall soft skills average
        const allSoftSkillRatings = Object.values(softSkillsByArea).flatMap(a => a.ratings);
        const overallSoftSkillAverage = allSoftSkillRatings.length > 0
            ? Math.round((allSoftSkillRatings.reduce((a, b) => a + b, 0) / allSoftSkillRatings.length) * 100) / 100
            : null;

        // Individual criteria with their averages
        const softSkillCriteria = Array.from(criteriaMap.values())
            .map(c => ({
                code: c.code,
                name: c.name,
                competencyArea: c.area,
                kLevel: c.kLevel,
                averageGrade: c.ratings.length > 0
                    ? Math.round((c.ratings.reduce((a, b) => a + b, 0) / c.ratings.length) * 100) / 100
                    : null,
                ratingCount: c.ratings.length,
            }))
            .sort((a, b) => a.code.localeCompare(b.code));

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
            approvedReportsCount,
            totalEvaluatedUseCases,
            totalHours,
            avgWeeklyHours,
            // === SOFT SKILLS DATA ===
            softSkills: {
                averages: softSkillAverages,
                overallAverage: overallSoftSkillAverage,
                criteria: softSkillCriteria,
                totalRatings: allSoftSkillRatings.length,
            },
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
        console.error('Error in arbeitszeugnis aggregate API:', error);
        return NextResponse.json({ error: 'Interner Serverfehler beim Aggregieren der Leistungsdaten' }, { status: 500 });
    }
}
