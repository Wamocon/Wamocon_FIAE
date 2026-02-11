import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { workCertificates, profiles } from '@/db/migrations/schemas/schema';
import { eq } from 'drizzle-orm';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ code: string }> }
) {
    try {
        const { code } = await params;

        // Fetch certificate with snapshot data
        const certificate = await db
            .select({
                snapshotData: workCertificates.snapshotData,
                issueDate: workCertificates.issueDate,
                qrVerificationCode: workCertificates.qrVerificationCode,
                qrVerificationUrl: workCertificates.qrVerificationUrl,
                gender: workCertificates.gender,
                customSummary: workCertificates.customSummary,
                approvedBy: workCertificates.approvedByTrainerId,
            })
            .from(workCertificates)
            .where(eq(workCertificates.qrVerificationCode, code))
            .limit(1);

        if (!certificate[0] || !certificate[0].snapshotData) {
            return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });
        }

        const cert = certificate[0];
        const snapshot = cert.snapshotData as any; // Type assertion since it's JSONB

        // Fetch signer name if possible
        let signerName = 'Ausbildungsleitung';
        if (cert.approvedBy) {
            const signer = await db
                .select({ fullName: profiles.fullName })
                .from(profiles)
                .where(eq(profiles.id, cert.approvedBy))
                .limit(1);
            if (signer[0]?.fullName) {
                signerName = signer[0].fullName;
            }
        }

        // Reconstruct CertificateData for PDF Generator
        // Map snapshot data to PDF schema
        const pdfData = {
            traineeName: snapshot.traineeName,
            startDate: snapshot.periodStart,
            endDate: snapshot.periodEnd,
            izhkProfile: 'Fachinformatiker für Anwendungsentwicklung', // TODO: Store in snapshot if variable
            companyName: 'WAMOCON GmbH',
            components: snapshot.components.map((c: any) => ({
                title: c.title,
                grade: c.finalGrade
            })),
            averageGrade: snapshot.overallAverage || 0,
            qrCodeUrl: cert.qrVerificationUrl,
            verificationCode: cert.qrVerificationCode,
            issuedAt: cert.issueDate,
            signerName: signerName,
            gender: cert.gender,
            summary: cert.customSummary,
            radarImage: snapshot.radarImage // Now retrieving stored image
        };

        return NextResponse.json(pdfData);

    } catch (error) {
        console.error('Download error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
