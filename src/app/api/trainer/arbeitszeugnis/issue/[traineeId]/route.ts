import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  workCertificates,
  activityReports,
  activityReportUseCaseEntries,
  trainingUseCases,
  trainingComponents,
  profiles,
} from '@/db/migrations/schemas/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { getUserOrgId } from '@/lib/auth-helpers';
import { generateCertificateText } from '@/lib/arbeitszeugnis/textGenerator';
import { getBaseUrlFromRequest } from '@/lib/url';
import { getTrainingYearDateRange } from '@/lib/ausbildung/duration';

/**
 * POST /api/trainer/arbeitszeugnis/issue/[traineeId]
 *
 * Issues a work certificate with:
 * - Frozen snapshot of grades (immutable state)
 * - Unique QR verification code
 * - Generated text based on grades
 *
 * Body:
 * - ausbildungsjahr: Training phase (1 or 2), 0 for the full final period
 * - certificateType: 'INTERIM' or 'FINAL'
 * - customSummary: Trainer's personal summary text
 * - gender: 'male' | 'female' | 'neutral'
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ traineeId: string }> }
) {
  try {
    const { traineeId } = await params;

    if (!traineeId) {
      return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });
    }

    const body = await request.json();
    const {
      ausbildungsjahr = 1,
      certificateType = 'INTERIM',
      customSummary = '',
      overallAssessment = '',
      manualOverallGrade = null,
      gender = 'neutral',
      radarImage,
      startDate,
      endDate,
      trainerId,
      traineeBirthDate,
      softSkills,
    } = body;

    // Server-side validation for required fields
    if (!overallAssessment || overallAssessment.trim().length === 0) {
      return NextResponse.json(
        {
          error:
            'Gesamturteil fehlt. Bitte generieren Sie es vor dem Ausstellen.',
        },
        { status: 400 }
      );
    }

    if (
      manualOverallGrade === null ||
      manualOverallGrade < 1 ||
      manualOverallGrade > 6
    ) {
      return NextResponse.json(
        { error: 'Gesamtnote fehlt oder ist ungültig.' },
        { status: 400 }
      );
    }

    // Get trainee info
    const traineeProfile = await db
      .select({
        startDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
        fullName: profiles.fullName,
        birthDate: profiles.birthDate,
      })
      .from(profiles)
      .where(eq(profiles.id, traineeId))
      .limit(1);

    if (!traineeProfile[0]) {
      return NextResponse.json({ error: 'Trainee not found' }, { status: 404 });
    }

    const organizationId = await getUserOrgId(trainerId || traineeId);

    let yearStart: Date;
    let yearEnd: Date;
    const certificateAusbildungsjahr =
      certificateType === 'FINAL'
        ? 0
        : ausbildungsjahr === 3
          ? 3
          : ausbildungsjahr === 2
            ? 2
            : 1;

    if (certificateType !== 'FINAL' && startDate && endDate) {
      yearStart = new Date(startDate);
      yearEnd = new Date(endDate);
      if (yearEnd.getUTCHours() === 0 && yearEnd.getUTCMinutes() === 0) {
        yearEnd.setUTCHours(23, 59, 59, 999);
      }
    } else {
      const startOfTraining =
        traineeProfile[0].startDate || new Date('2025-08-01');
      const range = getTrainingYearDateRange(
        startOfTraining,
        certificateAusbildungsjahr,
        traineeProfile[0].ausbildungDurationYears
      );
      yearStart = range.startDate;
      yearEnd = range.endDate;
    }

    // Fetch all graded use case entries for snapshot
    const gradedEntries = await db
      .select({
        entryId: activityReportUseCaseEntries.id,
        traineeGrade: activityReportUseCaseEntries.traineeGrade,
        trainerGrade: activityReportUseCaseEntries.trainerGrade,
        actualHours: activityReportUseCaseEntries.actualHours,
        useCaseLetter: trainingUseCases.letter,
        useCaseDescription: trainingUseCases.description,
        componentCode: trainingComponents.code,
        componentTitle: trainingComponents.title,
        componentOrderIndex: trainingComponents.orderIndex,
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
          lte(activityReports.periodStart, yearEnd)
        )
      )
      .orderBy(trainingComponents.orderIndex, trainingUseCases.orderIndex);

    // Build snapshot data (frozen at issue time)
    // trainerGrade is the final grade (migration 0033 merged release_grade into trainer_grade)
    const componentMap = new Map<
      string,
      {
        code: string;
        title: string;
        orderIndex: number;
        useCases: Array<{
          letter: string;
          description: string;
          traineeGrade: string | null;
          trainerGrade: string | null;
          effectiveGrade: string | null;
          hours: number;
        }>;
        gradeSum: number;
        gradedCount: number;
      }
    >();

    for (const entry of gradedEntries) {
      const key = entry.componentCode;

      if (!componentMap.has(key)) {
        componentMap.set(key, {
          code: entry.componentCode,
          title: entry.componentTitle,
          orderIndex: entry.componentOrderIndex,
          useCases: [],
          gradeSum: 0,
          gradedCount: 0,
        });
      }

      const comp = componentMap.get(key)!;
      const effectiveGrade = entry.trainerGrade;

      comp.useCases.push({
        letter: entry.useCaseLetter,
        description: entry.useCaseDescription,
        traineeGrade: entry.traineeGrade,
        trainerGrade: entry.trainerGrade,
        effectiveGrade,
        hours: entry.actualHours,
      });

      if (effectiveGrade) {
        comp.gradedCount++;
        comp.gradeSum += parseInt(effectiveGrade);
      }
    }

    const components = Array.from(componentMap.values())
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(comp => ({
        code: comp.code,
        title: comp.title,
        useCases: comp.useCases,
        averageGrade:
          comp.gradedCount > 0
            ? Math.round((comp.gradeSum / comp.gradedCount) * 100) / 100
            : null,
        finalGrade:
          comp.gradedCount > 0
            ? Math.round(comp.gradeSum / comp.gradedCount)
            : null,
      }));

    // Calculate overall average
    const gradedComponents = components.filter(c => c.averageGrade !== null);
    const overallAverage =
      gradedComponents.length > 0
        ? gradedComponents.reduce((sum, c) => sum + (c.averageGrade || 0), 0) /
          gradedComponents.length
        : null;

    // Generate verification code (URL-safe, 16 chars)
    const qrVerificationCode = randomBytes(12)
      .toString('base64url')
      .slice(0, 16);
    const baseUrl = getBaseUrlFromRequest(request);
    const qrVerificationUrl = `${baseUrl}/verify/${qrVerificationCode}`;

    // Generate certificate text based on grades
    const generatedText = generateCertificateText(
      traineeProfile[0].fullName || 'Auszubildende/r',
      components,
      overallAverage,
      gender,
      certificateType
    );

    // Create the certificate with snapshot
    const snapshotData = {
      frozenAt: new Date().toISOString(),
      traineeId,
      traineeName: traineeProfile[0].fullName,
      traineeBirthDate: traineeBirthDate || traineeProfile[0].birthDate || null,
      ausbildungsjahr: certificateAusbildungsjahr,
      ausbildungDurationYears: traineeProfile[0].ausbildungDurationYears ?? 3,
      periodStart: yearStart.toISOString(),
      periodEnd: yearEnd.toISOString(),
      components,
      overallAverage,
      manualOverallGrade,
      overallAssessment: overallAssessment.trim(),
      shorteningEligible: overallAverage !== null && overallAverage < 2.45,
      radarImage, // Store the radar image in the snapshot
      softSkills: softSkills || null, // Store soft skills in the snapshot
    };

    const [certificate] = await db
      .insert(workCertificates)
      .values({
        traineeId,
        certificateType,
        issueDate: new Date(),
        periodStart: yearStart,
        periodEnd: yearEnd,
        ausbildungsjahr: certificateAusbildungsjahr,
        generatedText,
        customSummary,
        snapshotData,
        qrVerificationCode,
        qrVerificationUrl,
        gender,
        status: 'ISSUED',
        approvedByTrainerId: trainerId || null,
        approvedAt: new Date(),
        isLocked: true,
        lockedAt: new Date(),
        organizationId,
      })
      .returning();

    return NextResponse.json({
      success: true,
      certificate: {
        id: certificate.id,
        type: certificate.certificateType,
        issueDate: certificate.issueDate,
        qrVerificationCode,
        qrVerificationUrl,
        overallAverage,
        shorteningEligible: snapshotData.shorteningEligible,
      },
    });
  } catch (error: unknown) {
    console.error('Error issuing certificate:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler beim Ausstellen des Zeugnisses' },
      { status: 500 }
    );
  }
}

/**
 * Generate certificate text based on grades and gender
 */
