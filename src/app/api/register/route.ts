import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function deriveNameFromEmail(email: string) {
  const local = (email || '').split('@')[0] || '';
  // replace separators with spaces, remove other non-alphanum, collapse spaces
  const cleaned = local.replace(/[._+\-]/g, ' ').replace(/[^a-zA-Z0-9 ]/g, ' ');
  const parts = cleaned.split(' ').filter(Boolean);
  const capitalized = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
  return capitalized || local;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;
    if (!email || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const allowlistCsv = process.env.ALLOWED_TRAINER_EMAILS || '';

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server misconfigured: missing supabase keys' }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const allowedList = allowlistCsv ? allowlistCsv.split(',').map((s: string) => s.trim().toLowerCase()) : [];
    const emailLower = email.trim().toLowerCase();
  const role = allowedList.includes(emailLower) ? 'TRAINER' : 'TRAINEE';
    const full_name = deriveNameFromEmail(email);

    // Create auth user via admin
    // Using admin.auth.admin.createUser (some supabase versions expose admin namespace)
    const { data: created, error } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name, role },
    });

    // Log the raw response for debugging (server-side log)
    console.debug('admin.createUser response:', { data: created, error });

    if (error) {
      console.error('createUser error detail:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const user = created?.user;
    if (!user || !user.id) {
      return NextResponse.json({ error: 'Failed to create auth user' }, { status: 500 });
    }

    // Rely on the DB trigger to create the profile row using user_metadata.
    // Optionally, we could poll for the profile to exist, but for now just return success.
    return NextResponse.json({ user: { id: user.id } }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
