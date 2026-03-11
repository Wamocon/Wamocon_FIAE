import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  workCertificates,
  profiles,
  activityReports,
  weeklyEvaluations,
  weeklySoftskillRatings,
  mesSoftskillCriteria,
} from '@/db/migrations/schemas/schema';
import { eq, and, gte, lte, isNotNull, inArray } from 'drizzle-orm';
import { generateArbeitszeugnisPDF } from '@/lib/arbeitszeugnis/pdfGenerator';
import QRCode from 'qrcode';

/**
 * GET /api/verify/[code]/download
 *
 * Public endpoint to download a certificate PDF by verification code.
 * No authentication required - anyone with the QR code can download.
 * Returns the PDF as a downloadable blob.
 */
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
        approvedByTrainerId: workCertificates.approvedByTrainerId,
        traineeId: workCertificates.traineeId,
      })
      .from(workCertificates)
      .where(eq(workCertificates.qrVerificationCode, code))
      .limit(1);

    if (!certificate[0] || !certificate[0].snapshotData) {
      return NextResponse.json(
        { error: 'Certificate not found' },
        { status: 404 }
      );
    }

    const cert = certificate[0];
    const snapshot = cert.snapshotData as any;

    // Fetch signer name and trainee birth date from profiles
    let signerName = 'Ausbildungsleitung';
    let traineeBirthDate = snapshot.traineeBirthDate || null;

    // Fetch signer name
    if (cert.approvedByTrainerId) {
      const signer = await db
        .select({ fullName: profiles.fullName })
        .from(profiles)
        .where(eq(profiles.id, cert.approvedByTrainerId))
        .limit(1);
      if (signer[0]?.fullName) {
        signerName = signer[0].fullName;
      }
    }

    // If birth date not in snapshot, fetch from trainee profile
    if (!traineeBirthDate && cert.traineeId) {
      const traineeProfile = await db
        .select({ birthDate: profiles.birthDate })
        .from(profiles)
        .where(eq(profiles.id, cert.traineeId))
        .limit(1);
      if (traineeProfile[0]?.birthDate) {
        traineeBirthDate = traineeProfile[0].birthDate;
      }
    }

    // Reconstruct soft skills if missing from snapshot
    let softSkills = snapshot.softSkills;
    if (
      !softSkills &&
      cert.traineeId &&
      snapshot.periodStart &&
      snapshot.periodEnd
    ) {
      try {
        // Query approved activity reports in the period
        const reports = await db
          .select({ id: activityReports.id })
          .from(activityReports)
          .where(
            and(
              eq(activityReports.traineeId, cert.traineeId),
              eq(activityReports.status, 'APPROVED'),
              gte(activityReports.periodStart, new Date(snapshot.periodStart)),
              lte(activityReports.periodEnd, new Date(snapshot.periodEnd))
            )
          );

        if (reports.length > 0) {
          const reportIds = reports.map(r => r.id);

          // Find weekly evaluations for these reports
          const relevantEvaluations = await db
            .select({
              id: weeklyEvaluations.id,
              activityReportId: weeklyEvaluations.activityReportId,
            })
            .from(weeklyEvaluations)
            .where(
              and(
                isNotNull(weeklyEvaluations.activityReportId),
                inArray(weeklyEvaluations.activityReportId, reportIds)
              )
            );

          if (relevantEvaluations.length > 0) {
            const evaluationIds = relevantEvaluations.map(e => e.id);

            // Get MES ratings with criteria info for these evaluations
            // Use effective rating: trainerRating (migration 0033 merged releaseRating into trainerRating)
            const relevantRatings = await db
              .select({
                weeklyEvaluationId: weeklySoftskillRatings.weeklyEvaluationId,
                trainerRating: weeklySoftskillRatings.trainerRating,
                competencyArea: mesSoftskillCriteria.competencyArea,
              })
              .from(weeklySoftskillRatings)
              .innerJoin(
                mesSoftskillCriteria,
                eq(
                  weeklySoftskillRatings.softskillCriterionId,
                  mesSoftskillCriteria.id
                )
              )
              .where(
                and(
                  isNotNull(weeklySoftskillRatings.trainerRating),
                  inArray(
                    weeklySoftskillRatings.weeklyEvaluationId,
                    evaluationIds
                  )
                )
              );

            // Helper to convert string ratings to numbers
            const ratingToNumber = (rating: string | null): number | null => {
              if (!rating) return null;
              const map: Record<string, number> = {
                '1': 1,
                '2': 2,
                '3': 3,
                '4': 4,
                '5': 5,
                '6': 6,
              };
              return map[rating] ?? null;
            };

            // Group by competency area
            const competencyAreas = [
              'FACHKOMPETENZ',
              'METHODENKOMPETENZ',
              'PERSONALKOMPETENZ',
            ] as const;
            const softSkillsByArea: Record<string, number[]> = {};

            for (const area of competencyAreas) {
              softSkillsByArea[area] = [];
            }

            for (const rating of relevantRatings) {
              // trainerRating is the final effective rating
              const effectiveRatingStr = rating.trainerRating;
              const numRating = ratingToNumber(effectiveRatingStr);
              if (numRating !== null && rating.competencyArea) {
                softSkillsByArea[rating.competencyArea]?.push(numRating);
              }
            }
            // Calculate averages
            const fachAvg =
              softSkillsByArea.FACHKOMPETENZ.length > 0
                ? Math.round(
                    (softSkillsByArea.FACHKOMPETENZ.reduce((a, b) => a + b, 0) /
                      softSkillsByArea.FACHKOMPETENZ.length) *
                      100
                  ) / 100
                : null;
            const methodAvg =
              softSkillsByArea.METHODENKOMPETENZ.length > 0
                ? Math.round(
                    (softSkillsByArea.METHODENKOMPETENZ.reduce(
                      (a, b) => a + b,
                      0
                    ) /
                      softSkillsByArea.METHODENKOMPETENZ.length) *
                      100
                  ) / 100
                : null;
            const personalAvg =
              softSkillsByArea.PERSONALKOMPETENZ.length > 0
                ? Math.round(
                    (softSkillsByArea.PERSONALKOMPETENZ.reduce(
                      (a, b) => a + b,
                      0
                    ) /
                      softSkillsByArea.PERSONALKOMPETENZ.length) *
                      100
                  ) / 100
                : null;

            const allRatings = Object.values(softSkillsByArea).flat();
            const overallAvg =
              allRatings.length > 0
                ? Math.round(
                    (allRatings.reduce((a, b) => a + b, 0) /
                      allRatings.length) *
                      100
                  ) / 100
                : null;

            if (
              fachAvg !== null ||
              methodAvg !== null ||
              personalAvg !== null
            ) {
              softSkills = {
                averages: {
                  fachkompetenz: fachAvg,
                  methodenkompetenz: methodAvg,
                  personalkompetenz: personalAvg,
                },
                overallAverage: overallAvg || 0,
              };
              console.log(
                'Reconstructed soft skills:',
                JSON.stringify(softSkills, null, 2)
              );
            } else {
              console.log('No valid soft skills averages to reconstruct');
            }
          }
        }
      } catch (e) {
        console.error('Error reconstructing soft skills:', e);
      }
    }

    console.log('Final softSkills value:', softSkills ? 'Present' : 'Missing');

    // Generate QR code image
    let qrImageBase64 = '';
    try {
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL || 'https://fiae-learn.com';
      const qrUrl = `${baseUrl.replace(/\/$/, '')}/verify/${code}`;
      qrImageBase64 = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 200,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch (e) {
      console.error('Error generating QR code:', e);
    }

    // Load logo (Node.js compatible - no FileReader)
    let logoImageBase64 = '';
    try {
      const logoResponse = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/content/WMC_Logo.png`
      );
      console.log('Logo fetch response:', logoResponse.status, logoResponse.ok);
      if (logoResponse.ok) {
        const arrayBuffer = await logoResponse.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const contentType =
          logoResponse.headers.get('content-type') || 'image/png';
        logoImageBase64 = `data:${contentType};base64,${base64}`;
        console.log('Logo loaded, size:', base64.length, 'bytes');
      } else {
        console.log(
          'Logo fetch failed:',
          logoResponse.status,
          logoResponse.statusText
        );
      }
    } catch (e) {
      console.error('Error loading logo:', e);
    }

    // Generate PDF
    const genderValue = (
      ['male', 'female', 'neutral'].includes(cert.gender || '')
        ? cert.gender
        : 'neutral'
    ) as 'male' | 'female' | 'neutral';

    // Generate default summary if missing
    const traineeName = snapshot.traineeName || 'Auszubildender';
    const summaryText =
      cert.customSummary ||
      `Person ${traineeName} hat die ihm übertragenen Aufgaben stets zu unserer vollen Zufriedenheit erledigt. Wir danken für die angenehme Zusammenarbeit und wünschen für die berufliche und private Zukunft alles Gute.`;

    console.log('PDF Generation params:', {
      logoImage: logoImageBase64
        ? `${logoImageBase64.substring(0, 50)}... (${logoImageBase64.length} chars)`
        : 'MISSING',
      softSkills: softSkills ? 'Present' : 'MISSING',
      radarImage: snapshot.radarImage ? 'Present' : 'MISSING',
      summary: summaryText ? 'Present' : 'MISSING',
    });

    const pdfBlob = await generateArbeitszeugnisPDF({
      traineeName: traineeName,
      traineeBirthDate: traineeBirthDate || undefined,
      startDate: snapshot.periodStart,
      endDate: snapshot.periodEnd,
      izhkProfile:
        snapshot.izhkProfile || 'Fachinformatiker für Anwendungsentwicklung',
      companyName: snapshot.companyName || 'WAMOCON GmbH',
      components:
        snapshot.components?.map((c: any) => ({
          title: c.title,
          grade: c.finalGrade,
          hours: c.totalHours || 0,
        })) || [],
      averageGrade: snapshot.overallAverage || 0,
      qrCodeUrl: qrImageBase64,
      verificationCode: cert.qrVerificationCode || code,
      issuedAt: new Date(cert.issueDate),
      signerName: signerName,
      gender: genderValue,
      summary: summaryText,
      radarImage: snapshot.radarImage || undefined,
      logoImage: logoImageBase64,
      softSkills: softSkills || undefined,
    });

    // Return PDF for download
    const filename = `${snapshot.traineeName || 'Arbeitszeugnis'}.pdf`;

    return new NextResponse(pdfBlob, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control':
          'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  } catch (error: any) {
    console.error('Download error:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS handler for CORS preflight requests
 * Allows downloads from any device/domain
 */
export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    }
  );
}
