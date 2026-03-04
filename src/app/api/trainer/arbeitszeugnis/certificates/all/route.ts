import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { workCertificates, profiles } from '@/db/migrations/schemas/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * GET /api/trainer/arbeitszeugnis/certificates/all
 *
 * Fetches ALL existing certificates across all trainees with snapshot data.
 * Used for bulk re-downloading PDFs with updated templates.
 */
export async function GET(request: NextRequest) {
  try {
    const certificates = await db
      .select({
        id: workCertificates.id,
        traineeId: workCertificates.traineeId,
        certificateType: workCertificates.certificateType,
        issueDate: workCertificates.issueDate,
        periodStart: workCertificates.periodStart,
        periodEnd: workCertificates.periodEnd,
        ausbildungsjahr: workCertificates.ausbildungsjahr,
        qrVerificationCode: workCertificates.qrVerificationCode,
        qrVerificationUrl: workCertificates.qrVerificationUrl,
        status: workCertificates.status,
        snapshotData: workCertificates.snapshotData,
        gender: workCertificates.gender,
        customSummary: workCertificates.customSummary,
        traineeName: profiles.fullName,
      })
      .from(workCertificates)
      .innerJoin(profiles, eq(workCertificates.traineeId, profiles.id))
      .orderBy(desc(workCertificates.issueDate));

    return NextResponse.json({
      certificates,
      total: certificates.length,
    });
  } catch (error: unknown) {
    console.error('Error fetching all certificates:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler beim Laden der Zeugnisse' },
      { status: 500 }
    );
  }
}
