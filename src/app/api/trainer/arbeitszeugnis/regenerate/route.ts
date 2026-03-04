import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { workCertificates, profiles } from '@/db/migrations/schemas/schema';
import { eq, sql } from 'drizzle-orm';

/**
 * POST /api/trainer/arbeitszeugnis/regenerate
 *
 * Updates all existing certificate snapshots with correct birthdate from profiles table.
 * This fixes certificates that were issued when birthdate was not being passed correctly.
 *
 * Body (optional):
 * - certificateId: string — if provided, only update this specific certificate
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { certificateId } = body;

    // Get all certificates (or a specific one)
    const conditions = certificateId
      ? eq(workCertificates.id, certificateId)
      : undefined;

    const certificates = await db
      .select({
        id: workCertificates.id,
        traineeId: workCertificates.traineeId,
        snapshotData: workCertificates.snapshotData,
      })
      .from(workCertificates)
      .where(conditions);

    if (certificates.length === 0) {
      return NextResponse.json({
        message: 'No certificates found',
        updated: 0,
      });
    }

    // Get all unique trainee IDs
    const traineeIds = [...new Set(certificates.map(c => c.traineeId))];

    // Fetch birthdates for all trainees
    const traineeProfiles = await db
      .select({
        id: profiles.id,
        birthDate: profiles.birthDate,
      })
      .from(profiles)
      .where(
        traineeIds.length === 1
          ? eq(profiles.id, traineeIds[0])
          : sql`${profiles.id} IN (${sql.join(
              traineeIds.map(id => sql`${id}`),
              sql`, `
            )})`
      );

    const birthDateMap = new Map<string, string | null>();
    for (const p of traineeProfiles) {
      birthDateMap.set(
        String(p.id),
        p.birthDate ? new Date(p.birthDate).toISOString() : null
      );
    }

    // Update each certificate's snapshot with the correct birthdate
    let updatedCount = 0;
    for (const cert of certificates) {
      const birthDate = birthDateMap.get(cert.traineeId);
      const snapshot = (cert.snapshotData as Record<string, unknown>) || {};

      // Only update if birthdate was missing/null in snapshot but exists in profile
      if (birthDate && !snapshot.traineeBirthDate) {
        const updatedSnapshot = {
          ...snapshot,
          traineeBirthDate: birthDate,
        };

        await db
          .update(workCertificates)
          .set({ snapshotData: updatedSnapshot })
          .where(eq(workCertificates.id, cert.id));

        updatedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${updatedCount} of ${certificates.length} certificates with correct birthdate`,
      updated: updatedCount,
      total: certificates.length,
    });
  } catch (error: unknown) {
    console.error('Error regenerating certificates:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler beim Aktualisieren der Zeugnisse' },
      { status: 500 }
    );
  }
}
