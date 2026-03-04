/**
 * Script: fix-certificate-birthdates.ts
 *
 * Updates all existing work_certificates in the database to include
 * the correct traineeBirthDate in their snapshot_data JSON.
 *
 * This fixes certificates that were issued when the birthdate was not
 * being passed correctly from the with-stats API.
 *
 * Usage: npx tsx scripts/fix-certificate-birthdates.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import db from '../src/db';
import {
  workCertificates,
  profiles,
} from '../src/db/migrations/schemas/schema';
import { eq, sql } from 'drizzle-orm';

async function fixCertificateBirthdates() {
  console.log('🔍 Fetching all certificates...');

  const certificates = await db
    .select({
      id: workCertificates.id,
      traineeId: workCertificates.traineeId,
      snapshotData: workCertificates.snapshotData,
    })
    .from(workCertificates);

  console.log(`📋 Found ${certificates.length} certificates`);

  if (certificates.length === 0) {
    console.log('✅ No certificates to update');
    return;
  }

  // Get all unique trainee IDs
  const traineeIds = [...new Set(certificates.map(c => c.traineeId))];
  console.log(`👥 Found ${traineeIds.length} unique trainees`);

  // Fetch birthdates for all trainees
  const traineeProfiles = await db
    .select({
      id: profiles.id,
      birthDate: profiles.birthDate,
      fullName: profiles.fullName,
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

  const birthDateMap = new Map<
    string,
    { birthDate: string | null; fullName: string | null }
  >();
  for (const p of traineeProfiles) {
    birthDateMap.set(String(p.id), {
      birthDate: p.birthDate ? new Date(p.birthDate).toISOString() : null,
      fullName: p.fullName,
    });
  }

  let updatedCount = 0;
  let skippedCount = 0;
  let noBirthdateCount = 0;

  for (const cert of certificates) {
    const traineeInfo = birthDateMap.get(cert.traineeId);
    const snapshot = (cert.snapshotData as Record<string, unknown>) || {};
    const existingBirthDate = snapshot.traineeBirthDate;

    if (existingBirthDate) {
      skippedCount++;
      console.log(
        `  ⏭️  Certificate ${cert.id} already has birthdate, skipping`
      );
      continue;
    }

    if (!traineeInfo?.birthDate) {
      noBirthdateCount++;
      console.log(
        `  ⚠️  Certificate ${cert.id} (${traineeInfo?.fullName || 'unknown'}) - no birthdate in profile`
      );
      continue;
    }

    const updatedSnapshot = {
      ...snapshot,
      traineeBirthDate: traineeInfo.birthDate,
    };

    await db
      .update(workCertificates)
      .set({ snapshotData: updatedSnapshot })
      .where(eq(workCertificates.id, cert.id));

    updatedCount++;
    console.log(
      `  ✅ Updated certificate ${cert.id} for ${traineeInfo.fullName} with birthdate`
    );
  }

  console.log('\n📊 Summary:');
  console.log(`  Total certificates: ${certificates.length}`);
  console.log(`  Updated with birthdate: ${updatedCount}`);
  console.log(`  Already had birthdate: ${skippedCount}`);
  console.log(`  No birthdate in profile: ${noBirthdateCount}`);
  console.log('\n✅ Done!');
}

fixCertificateBirthdates()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
