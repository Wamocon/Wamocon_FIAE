import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const emails = ['trainer1@test.com', 'trainer2@test.com'];
const password = 'trainer';

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

  for (const email of emails) {
    const emailLower = email.toLowerCase();
    const existing = existingByEmail.get(emailLower);

    let userId: string | undefined;

    if (existing?.id) {
      const { data: updated, error: updateError } =
        await admin.auth.admin.updateUserById(existing.id, {
          email,
          password,
          email_confirm: true,
          user_metadata: { role: 'TRAINER', full_name: 'Trainer' },
        });
      if (updateError) {
        throw updateError;
      }
      userId = updated.user?.id;
      console.log(`Updated auth user for ${email}`);
    } else {
      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { role: 'TRAINER', full_name: 'Trainer' },
        });
      if (createError) {
        throw createError;
      }
      userId = created.user?.id;
      console.log(`Created auth user for ${email}`);
    }

    if (!userId) {
      throw new Error(`No user id returned for ${email}`);
    }

    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id: userId,
        email,
        full_name: 'Trainer',
        role: 'TRAINER',
        is_active: true,
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      throw profileError;
    }

    console.log(`Upserted profile for ${email}`);
  }

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
