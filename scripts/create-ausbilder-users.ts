import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Test users to create
const users = [
  {
    email: 'ausbilder@test.com',
    password: 'ausbilder123',
    role: 'TRAINER' as const,
    full_name: 'Ausbilder',
  },
  {
    email: 'auszubildende@test.com',
    password: 'auszubildende123',
    role: 'TRAINEE' as const,
    full_name: 'Auszubildende',
  },
];

function getSupabaseUrl() {
  return (
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_URL_INTERNAL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
}

async function main() {
  const supabaseUrl = getSupabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: listData, error: listError } = await admin.auth.admin.listUsers(
    {
      page: 1,
      perPage: 1000,
    }
  );

  if (listError) {
    throw listError;
  }

  const existingByEmail = new Map(
    (listData.users || []).map(u => [u.email?.toLowerCase() || '', u])
  );

  for (const user of users) {
    const emailLower = user.email.toLowerCase();
    const existing = existingByEmail.get(emailLower);

    let userId: string | undefined;

    if (existing?.id) {
      const { data: updated, error: updateError } =
        await admin.auth.admin.updateUserById(existing.id, {
          email: user.email,
          password: user.password,
          email_confirm: true,
          user_metadata: { role: user.role, full_name: user.full_name },
        });
      if (updateError) {
        throw updateError;
      }
      userId = updated.user?.id;
      console.log(`Updated auth user for ${user.email} (${user.role})`);
    } else {
      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email: user.email,
          password: user.password,
          email_confirm: true,
          user_metadata: { role: user.role, full_name: user.full_name },
        });
      if (createError) {
        throw createError;
      }
      userId = created.user?.id;
      console.log(`Created auth user for ${user.email} (${user.role})`);
    }

    if (!userId) {
      throw new Error(`No user id returned for ${user.email}`);
    }

    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id: userId,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        is_active: true,
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      throw profileError;
    }

    console.log(`Upserted profile for ${user.email} (${user.role})`);
  }

  // Link trainer and trainee
  const trainerProfile = await admin
    .from('profiles')
    .select('id')
    .eq('email', 'ausbilder@test.com')
    .single();

  const traineeProfile = await admin
    .from('profiles')
    .select('id')
    .eq('email', 'auszubildende@test.com')
    .single();

  if (trainerProfile.data && traineeProfile.data) {
    const { error: linkError } = await admin
      .from('profiles')
      .update({
        trainer_id: trainerProfile.data.id,
      })
      .eq('id', traineeProfile.data.id);

    if (linkError) {
      console.warn('Could not link trainee to trainer:', linkError.message);
    } else {
      console.log('Linked auszubildende@test.com → ausbilder@test.com');
    }
  }

  console.log('\nDone! Test users created:');
  console.log('  Trainer:  ausbilder@test.com / ausbilder123');
  console.log('  Trainee:  auszubildende@test.com / auszubildende123');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
