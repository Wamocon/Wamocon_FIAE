/**
 * Script to clean up QA database:
 * - Remove trainees with @gmail.com, @example.com, or other non-@test.com domains
 * - Keep only trainees with @test.com domain
 * - Also remove corresponding auth.users if they exist
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const QA_URL = 'https://thzssnabxgchzbsnbgoh.supabase.co';
const QA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!QA_SERVICE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

const ALLOWED_DOMAINS = ['@test.com']; // Only keep @test.com trainees
const KEEP_EMAILS = new Set([
  'trainer1@test.com',
  'trainer2@test.com',
  'trainer3@test.com',
  'trainee1@test.com',
  'trainee2@test.com',
  'trainee3@test.com',
]);

async function main() {
  const admin = createClient(QA_URL, QA_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  console.log('🧹 Starting QA database cleanup...\n');

  try {
    // Step 1: Get all TRAINEE profiles
    const { data: allTrainees, error: fetchErr } = await admin
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('role', 'TRAINEE')
      .order('email');

    if (fetchErr) throw fetchErr;

    console.log(`📋 Found ${allTrainees?.length || 0} trainee profiles:\n`);

    const toDelete: string[] = [];
    const toKeep: string[] = [];

    allTrainees?.forEach(t => {
      const isAllowed = KEEP_EMAILS.has(t.email);
      if (isAllowed) {
        toKeep.push(t.email);
        console.log(`  ✅ KEEP: ${t.email} (${t.full_name})`);
      } else {
        toDelete.push(t.id);
        console.log(`  ❌ DELETE: ${t.email} (${t.full_name})`);
      }
    });

    if (toDelete.length === 0) {
      console.log('\n✨ No unwanted trainees found. Database is clean!');
      return;
    }

    console.log('\n' + '='.repeat(60));
    console.log(
      `Proceeding to delete ${toDelete.length} unwanted trainee profile(s)...`
    );
    console.log('='.repeat(60) + '\n');

    // Step 2: Delete profiles (cascade will handle related data via FK)
    for (const profileId of toDelete) {
      const { error: deleteErr } = await admin
        .from('profiles')
        .delete()
        .eq('id', profileId);

      if (deleteErr) {
        console.error(`  ❌ Error deleting profile ${profileId}:`, deleteErr);
      } else {
        console.log(`  ✅ Deleted profile: ${profileId}`);
      }
    }

    // Step 3: Verify cleanup
    console.log('\n' + '='.repeat(60));
    console.log('Verifying cleanup...');
    console.log('='.repeat(60) + '\n');

    const { data: remainingTrainees, error: verifyErr } = await admin
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('role', 'TRAINEE')
      .order('email');

    if (verifyErr) throw verifyErr;

    console.log(
      `✅ Remaining trainee profiles (${remainingTrainees?.length || 0}):\n`
    );
    remainingTrainees?.forEach(t => {
      console.log(`  • ${t.email} (${t.full_name})`);
    });

    console.log('\n✨ Cleanup complete!');
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

main();
