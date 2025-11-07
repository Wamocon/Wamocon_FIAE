import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/db';
import { profiles } from '@/db/migrations/schemas/schema';
import { and, eq } from 'drizzle-orm';

function deriveNameFromEmail(email: string) {
  const local = (email || '').split('@')[0] || '';
  const cleaned = local.replace(/[._+\-]/g, ' ').replace(/[^a-zA-Z0-9 ]/g, ' ');
  const parts = cleaned.split(' ').filter(Boolean);
  const capitalized = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
  return capitalized || local;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body as { email: string; password: string };
    if (!email || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_URL_INTERNAL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Server misconfigured: missing Supabase URL or anon key' }, { status: 500 });
    }

    const allowlistCsv = (process.env.ALLOWED_TRAINER_EMAILS || process.env.NEXT_PUBLIC_ALLOWED_TRAINER_EMAILS || '').trim();
    const allowedList = allowlistCsv ? allowlistCsv.split(',').map((s: string) => s.trim().toLowerCase()) : [];
    const emailLower = email.trim().toLowerCase();
    const role = allowedList.includes(emailLower) ? 'TRAINER' : 'TRAINEE';
    const full_name = deriveNameFromEmail(email);

    // public client for signup (sends confirmation email on hosted supabase)
    const pub = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

    // compute redirect target after email confirmation
    const origin = (() => {
      try { return new URL(request.url).origin; } catch { return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'; }
    })();
    const emailRedirectTo = `${origin}/login`;

    const { data: signedUp, error: signUpError } = await pub.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name, role }, emailRedirectTo },
    });

    if (signUpError) {
      const msg = (signUpError as any)?.message || 'Sign up failed';
      const status = (signUpError as any)?.status || 400;

      // Fallback path: use service key to send invite if Supabase returns the known DB errors
      const isDbEmailErr = /database error (checking email|finding user)/i.test(msg);
      if (isDbEmailErr && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
          const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email.trim(), {
            data: { full_name, role },
            redirectTo: emailRedirectTo,
          } as any);
          if (!inviteErr) {
            return NextResponse.json({ invited: true }, { status: 200 });
          }
        } catch {
          // ignore and fall through
        }
      }
      return NextResponse.json({ error: msg }, { status });
    }

    const user = signedUp.user;
    // Hosted Supabase may not always return a fully hydrated user when email confirmation is required.
    if (!user?.id) {
      // The email has been sent; client can proceed to confirm and then log in.
      return NextResponse.json({ pending: true }, { status: 200 });
    }

    // Determine trainer assignment for trainees
    let assignedTrainerId: string | null = null;
    if (role === 'TRAINEE') {
      const defaultTrainerId = process.env.DEFAULT_TRAINER_ID?.trim();
      const defaultTrainerEmail = process.env.DEFAULT_TRAINER_EMAIL?.trim()?.toLowerCase();
      if (defaultTrainerId) {
        assignedTrainerId = defaultTrainerId;
      } else if (defaultTrainerEmail) {
        const t = await db
          .select({ id: profiles.id })
          .from(profiles)
          .where(and(eq(profiles.email, defaultTrainerEmail), eq(profiles.role, 'TRAINER')))
          .limit(1);
        assignedTrainerId = t[0]?.id ?? null;
      }
      if (!assignedTrainerId) {
        const trainers = await db
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.role, 'TRAINER'))
          .limit(1);
        assignedTrainerId = trainers[0]?.id ?? null;
      }
    }

    // Upsert profile immediately (id from auth)
    await db
      .insert(profiles)
      .values({
        id: user.id,
        email: user.email || email.trim(),
        fullName: full_name,
        role: role as any,
        assignedTrainerId: assignedTrainerId ?? undefined,
        isActive: role === 'TRAINER',
      })
      .onConflictDoNothing();

    if (role === 'TRAINEE' && assignedTrainerId) {
      await db
        .update(profiles)
        .set({ assignedTrainerId })
        .where(eq(profiles.id, user.id));
    }

    return NextResponse.json({ user: { id: user.id } }, { status: 200 });
  } catch (err: unknown) {
    // Surface details in server logs while returning a concise message to the client
    // eslint-disable-next-line no-console
    console.error('[api/register] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
