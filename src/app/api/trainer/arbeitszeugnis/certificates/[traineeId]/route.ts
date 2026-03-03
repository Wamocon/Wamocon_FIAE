import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { workCertificates, profiles } from '@/db/migrations/schemas/schema';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/trainer/arbeitszeugnis/certificates/[traineeId]
 * 
 * Fetches existing certificates for a trainee.
 * Returns the most recent certificate with QR code info.
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
        const ausbildungsjahr = searchParams.get('ausbildungsjahr');

        // Build query conditions
        const conditions = ausbildungsjahr
            ? and(
                eq(workCertificates.traineeId, traineeId),
                eq(workCertificates.ausbildungsjahr, parseInt(ausbildungsjahr))
              )
            : eq(workCertificates.traineeId, traineeId);

        // Fetch certificates
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
        return NextResponse.json({ error: 'Interner Serverfehler beim Laden der Zeugnisse' }, { status: 500 });
    }
}
