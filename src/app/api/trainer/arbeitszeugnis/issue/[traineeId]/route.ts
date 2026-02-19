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
import { generateCertificateText } from '@/lib/arbeitszeugnis/textGenerator';

/**
 * POST /api/trainer/arbeitszeugnis/issue/[traineeId]
 *
 * Issues a work certificate with:
 * - Frozen snapshot of grades (immutable state)
 * - Unique QR verification code
 * - Generated text based on grades
 *
 * Body:
 * - ausbildungsjahr: Training year (1, 2, or 3)
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
      gender = 'neutral',
      radarImage,
      startDate,
      endDate,
      trainerId,
      traineeBirthDate,
      softSkills,
    } = body;

    // Get trainee info
    const traineeProfile = await db
      .select({
        startDate: profiles.startOfTrainingDate,
        fullName: profiles.fullName,
        birthDate: profiles.birthDate,
      })
      .from(profiles)
      .where(eq(profiles.id, traineeId))
      .limit(1);

    if (!traineeProfile[0]) {
      return NextResponse.json({ error: 'Trainee not found' }, { status: 404 });
    }

    let yearStart: Date;
    let yearEnd: Date;

    if (startDate && endDate) {
      yearStart = new Date(startDate);
      yearEnd = new Date(endDate);
      if (yearEnd.getUTCHours() === 0 && yearEnd.getUTCMinutes() === 0) {
        yearEnd.setUTCHours(23, 59, 59, 999);
      }
    } else {
      const startOfTraining =
        traineeProfile[0].startDate || new Date('2025-08-01');

      yearStart = new Date(startOfTraining);
      yearStart.setFullYear(yearStart.getFullYear() + (ausbildungsjahr - 1));

      yearEnd = new Date(yearStart);
      yearEnd.setFullYear(yearEnd.getFullYear() + 1);
      yearEnd.setDate(yearEnd.getDate() - 1);
    }

    // Fetch all graded use case entries for snapshot
    const gradedEntries = await db
      .select({
        entryId: activityReportUseCaseEntries.id,
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
    const componentMap = new Map<
      string,
      {
        code: string;
        title: string;
        orderIndex: number;
        useCases: Array<{
          letter: string;
          description: string;
          grade: string | null;
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
      comp.useCases.push({
        letter: entry.useCaseLetter,
        description: entry.useCaseDescription,
        grade: entry.trainerGrade,
        hours: entry.actualHours,
      });

      if (entry.trainerGrade) {
        comp.gradedCount++;
        comp.gradeSum += parseInt(entry.trainerGrade);
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
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fiae-learn.com';
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
      ausbildungsjahr,
      periodStart: yearStart.toISOString(),
      periodEnd: yearEnd.toISOString(),
      components,
      overallAverage,
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
        ausbildungsjahr,
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
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('Error issuing certificate:', error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * Generate certificate text based on grades and gender
 */
