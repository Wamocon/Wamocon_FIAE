import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { workCertificates } from '@/db/migrations/schemas/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/verify/[code]
 * 
 * Public endpoint for QR code verification of certificates.
 * Returns certificate validity and basic info (no sensitive data).
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ code: string }> }
) {
    try {
        const { code } = await params;

        const certificate = await db
            .select({
                id: workCertificates.id,
                certificateType: workCertificates.certificateType,
                issueDate: workCertificates.issueDate,
                ausbildungsjahr: workCertificates.ausbildungsjahr,
                isLocked: workCertificates.isLocked,
                approvedAt: workCertificates.approvedAt,
            })
            .from(workCertificates)
            .where(eq(workCertificates.qrVerificationCode, code))
            .limit(1);

        if (!certificate[0]) {
            return NextResponse.json({
                valid: false,
                message: 'Dieses Zeugnis konnte nicht verifiziert werden. Der QR-Code ist ungültig oder das Zeugnis existiert nicht.',
                message_en: 'This certificate could not be verified. The QR code is invalid or the certificate does not exist.',
            }, { status: 404 });
        }

        const cert = certificate[0];

        return NextResponse.json({
            valid: true,
            verified: true,
            certificate: {
                // Keep terminology aligned with the generated PDF title:
                // INTERIM -> "LEISTUNGSBEURTEILUNG", FINAL -> "AUSBILDUNGSZEUGNIS".
                type: cert.certificateType === 'INTERIM' ? 'Leistungsbeurteilung' : 'Ausbildungszeugnis',
                type_en: cert.certificateType === 'INTERIM' ? 'Interim Performance Assessment' : 'Final Certificate',
                issueDate: cert.issueDate,
                trainingYear: cert.ausbildungsjahr,
                isAuthentic: cert.isLocked,
                approvedAt: cert.approvedAt,
            },
            // Legal disclaimer
            legalNote: {
                de: 'Dieses digitale Zeugnis ist gemäß §126a BGB i.V.m. der eIDAS-Verordnung rechtsverbindlich. Seit dem 01.01.2025 sind qualifiziert elektronisch signierte Arbeitszeugnisse nach dem Bürokratieentlastungsgesetz IV (BEG IV) der handschriftlichen Unterschrift gleichgestellt.',
                en: 'This digital certificate is legally binding according to §126a BGB in conjunction with the eIDAS Regulation. Since 01.01.2025, qualified electronically signed employment references are equivalent to handwritten signatures under the Fourth Bureaucracy Relief Act (BEG IV).',
            },
            issuer: 'WAMOCON GmbH',
            verificationTimestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error('Error verifying certificate:', error);
        return NextResponse.json({
            valid: false,
            error: 'Verification failed'
        }, { status: 500 });
    }
}
