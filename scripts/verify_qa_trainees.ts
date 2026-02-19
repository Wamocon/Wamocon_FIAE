/**
 * Script to list all TRAINEE profiles in QA database
 * (Non-destructive - just shows what's there)
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const QA_URL = 'https://thzssnabxgchzbsnbgoh.supabase.co';
const QA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!QA_SERVICE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

async function main() {
  const admin = createClient(QA_URL, QA_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  console.log('📋 Listing all trainee profiles in QA database...\n');

  try {
    // Get all profiles (not just TRAINEE)
    const { data: allProfiles, error: fetchErr } = await admin
      .from('profiles')
      .select('id, email, full_name, role, is_active')
      .order('email');

    if (fetchErr) throw fetchErr;

    console.log(`Total profiles: ${allProfiles?.length || 0}\n`);

    // Group by role
    const byRole: { [key: string]: typeof allProfiles } = {};
    allProfiles?.forEach(p => {
      if (!byRole[p.role]) byRole[p.role] = [];
      byRole[p.role].push(p);
    });

    // Display by role
    Object.entries(byRole).forEach(([role, profiles]) => {
      console.log(`\n🔹 ${role} (${profiles.length}):`);
      console.log('═'.repeat(60));
      profiles.forEach(p => {
        const domain = p.email.split('@')[1];
        const status = p.is_active ? '✓' : '✗';
        console.log(
          `  ${status} ${p.email.padEnd(30)} ${domain.padEnd(15)} [${p.full_name}]`
        );
      });
    });

    // Analysis
    console.log('\n' + '═'.repeat(60));
    console.log('📊 ANALYSIS:');
    console.log('═'.repeat(60));

    const trainees = byRole['TRAINEE'] || [];
    const domains = new Map<string, number>();

    trainees.forEach(t => {
      const domain = t.email.split('@')[1];
      domains.set(domain, (domains.get(domain) || 0) + 1);
    });

    console.log(`\nTrainee domains found:`);
    Array.from(domains.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([domain, count]) => {
        const isDesired = domain === 'test.com';
        const icon = isDesired ? '✓' : '✗';
        console.log(`  ${icon} @${domain}: ${count} trainees`);
      });
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
