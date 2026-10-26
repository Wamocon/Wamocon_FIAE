import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { workCertificates, profiles } from '@/db/migrations/schemas/schema';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/trainer/arbeitszeugnis/certificates/[traineeId]
 *
 * Fetches existing certificates for a trainee.
 * Returns the most recent certificate with QR code info and snapshot data.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ traineeId: string }> }
) {
  try {
    const session = await requireTrainer(request);
    if (isErrorResponse(session)) return session;

    const { traineeId } = await params;

    if (!traineeId) {
      return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });
    }

    const access = await requireTraineeAccess(session, traineeId, request);
    if (isErrorResponse(access)) return access;

    const { searchParams } = new URL(request.url);
    const ausbildungsjahr = searchParams.get('ausbildungsjahr');

    // Build query conditions
    const conditions = ausbildungsjahr
      ? and(
          eq(workCertificates.traineeId, traineeId),
          eq(workCertificates.ausbildungsjahr, parseInt(ausbildungsjahr))
        )
      : eq(workCertificates.traineeId, traineeId);

    // Fetch certificates with snapshot data for re-download
    const certificates = await db
      .select({
        id: workCertificates.id,
        certificateType: workCertificates.certificateType,
        issueDate: workCertificates.issueDate,
        periodStart: workCertificates.periodStart,
        periodEnd: workCertificates.periodEnd,
        ausbildungsjahr: workCertificates.ausbildungsjahr,
        qrVerificationCode: workCertificates.qrVerificationCode,
        qrVerificationUrl: workCertificates.qrVerificationUrl,
        status: workCertificates.status,
        pdfUrl: workCertificates.pdfUrl,
        snapshotData: workCertificates.snapshotData,
        gender: workCertificates.gender,
        customSummary: workCertificates.customSummary,
      })
      .from(workCertificates)
      .where(conditions)
      .orderBy(desc(workCertificates.issueDate));

    return NextResponse.json({
      certificates,
      latestCertificate: certificates.length > 0 ? certificates[0] : null,
    });
  } catch (error: unknown) {
    console.error('Error fetching certificates:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler beim Laden der Zeugnisse' },
      { status: 500 }
    );
  }
}
