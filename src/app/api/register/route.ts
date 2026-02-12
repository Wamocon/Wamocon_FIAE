import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/db';
import { profiles, notifications } from '@/db/migrations/schemas/schema';
import { and, eq } from 'drizzle-orm';

function deriveNameFromEmail(email: string) {
  const local = (email || '').split('@')[0] || '';
  const cleaned = local.replace(/[._+\-]/g, ' ').replace(/[^a-zA-Z0-9 ]/g, ' ');
  const parts = cleaned.split(' ').filter(Boolean);
  const capitalized = parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
  return capitalized || local;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body as { email: string; password: string };
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Missing email or password' },
        { status: 400 }
      );
    }

    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.SUPABASE_URL_INTERNAL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing Supabase URL or anon key' },
        { status: 500 }
      );
    }

    const allowlistCsv = (
      process.env.ALLOWED_TRAINER_EMAILS ||
      process.env.NEXT_PUBLIC_ALLOWED_TRAINER_EMAILS ||
      ''
    ).trim();
    const allowedList = allowlistCsv
      ? allowlistCsv.split(',').map((s: string) => s.trim().toLowerCase())
      : [];
    const emailLower = email.trim().toLowerCase();
    const role = allowedList.includes(emailLower) ? 'TRAINER' : 'TRAINEE';
    const full_name = deriveNameFromEmail(email);

    // Use service role to create user WITHOUT email confirmation
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing service role key' },
        { status: 500 }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Create user with admin API (no email confirmation required)
    const { data: signedUp, error: signUpError } =
      await admin.auth.admin.createUser({
        email: email.trim(),
        password,
        email_confirm: true, // Auto-confirm email
        user_metadata: { full_name, role },
      });

    if (signUpError) {
      const msg = (signUpError as any)?.message || 'Sign up failed';
      const status = (signUpError as any)?.status || 400;
      return NextResponse.json({ error: msg }, { status });
    }

    const user = signedUp.user;
    if (!user?.id) {
      return NextResponse.json(
        { error: 'Failed to create user' },
        { status: 500 }
      );
    }

    // Determine trainer assignment for trainees
    let assignedTrainerId: string | null = null;
    if (role === 'TRAINEE') {
      const defaultTrainerId = process.env.DEFAULT_TRAINER_ID?.trim();
      const defaultTrainerEmail =
        process.env.DEFAULT_TRAINER_EMAIL?.trim()?.toLowerCase();
      if (defaultTrainerId) {
        assignedTrainerId = defaultTrainerId;
      } else if (defaultTrainerEmail) {
        const t = await db
          .select({ id: profiles.id })
          .from(profiles)
          .where(
            and(
              eq(profiles.email, defaultTrainerEmail),
              eq(profiles.role, 'TRAINER')
            )
          )
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

    // Create profile with appropriate active status
    await db
      .insert(profiles)
      .values({
        id: user.id,
        email: user.email || email.trim(),
        fullName: full_name,
        role: role as any,
        assignedTrainerId: assignedTrainerId ?? undefined,
        isActive: role === 'TRAINER', // Trainers are active immediately, trainees need approval
      })
      .onConflictDoNothing();

    if (role === 'TRAINEE' && assignedTrainerId) {
      await db
        .update(profiles)
        .set({ assignedTrainerId })
        .where(eq(profiles.id, user.id));
    }

    // Create notification for trainers when a new trainee registers
    if (role === 'TRAINEE') {
      const trainerProfiles = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.role, 'TRAINER'), eq(profiles.isActive, true)));

      for (const trainer of trainerProfiles) {
        await db.insert(notifications).values({
          userId: trainer.id,
          actorId: user.id,
          type: 'TRAINEE_REGISTERED',
          title: 'Neue Azubi-Registrierung',
          message: `${full_name} (${email.trim()}) hat sich registriert und wartet auf Freischaltung.`,
          linkUrl: '/trainer/trainees',
          isRead: false,
        });
      }
    }

    return NextResponse.json(
      {
        success: true,
        role,
        user: { id: user.id, email: user.email, fullName: full_name },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    // Surface details in server logs while returning a concise message to the client
    // eslint-disable-next-line no-console
    console.error('[api/register] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
