import { getSupabasePublicKey, getSupabaseSecretKey } from '@/lib/env';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DB_OPTION } from '@/lib/db-schema';
import db from '@/db';
import { profiles, notifications } from '@/db/migrations/schemas/schema';
import { and, eq } from 'drizzle-orm';
import { getUserOrgId } from '@/lib/auth-helpers';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

// Public endpoint: at most 5 registrations per client address per hour
const REGISTER_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

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
    const rate = checkRateLimit(
      `register:${getClientIp(request.headers)}`,
      REGISTER_LIMIT
    );
    if (!rate.allowed) {
      const minutes = Math.ceil(rate.retryAfterSec / 60);
      return NextResponse.json(
        {
          error: `Zu viele Registrierungsversuche. Bitte versuchen Sie es in ${minutes} Minute${minutes === 1 ? '' : 'n'} erneut.`,
        },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
      );
    }

    let body: { email?: unknown; password?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Ungültige Anfrage.' },
        { status: 400 }
      );
    }
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !password) {
      return NextResponse.json(
        { error: 'E-Mail-Adresse und Passwort sind erforderlich.' },
        { status: 400 }
      );
    }
    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { error: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.' },
        { status: 400 }
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        {
          error: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
        },
        { status: 400 }
      );
    }

    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.SUPABASE_URL_INTERNAL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = getSupabasePublicKey();
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing Supabase URL or anon key' },
        { status: 500 }
      );
    }

    const emailLower = email.toLowerCase();

    // A profile for this address already exists (for example created by an
    // admin). Self-registration must never attach to it or inherit its role.
    const existingProfile = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, emailLower))
      .limit(1);
    if (existingProfile.length > 0) {
      return NextResponse.json(
        {
          error:
            'Diese E-Mail-Adresse ist bereits registriert. Bitte melden Sie sich an.',
        },
        { status: 409 }
      );
    }

    // Self-registration always creates a TRAINEE. Higher roles are assigned
    // by admins only, never derived from the request or from the email.
    const role = 'TRAINEE';
    const full_name = deriveNameFromEmail(email);

    // Use service role to create user WITHOUT email confirmation
    const serviceRoleKey = getSupabaseSecretKey();
    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing service role key' },
        { status: 500 }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
      db: DB_OPTION,
    });

    // Create user with admin API (no email confirmation required)
    const { data: signedUp, error: signUpError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Auto-confirm email
        user_metadata: { full_name },
      });

    if (signUpError) {
      const status = (signUpError as { status?: number })?.status;
      const msg = (signUpError as { message?: string })?.message || '';
      if (status === 422 || /already.*(registered|exists)/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              'Diese E-Mail-Adresse ist bereits registriert. Bitte melden Sie sich an.',
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error:
            'Die Registrierung ist fehlgeschlagen. Bitte versuchen Sie es erneut.',
        },
        { status: status && status >= 400 && status < 500 ? status : 400 }
      );
    }

    const user = signedUp.user;
    if (!user?.id) {
      return NextResponse.json(
        { error: 'Der Benutzer konnte nicht angelegt werden.' },
        { status: 500 }
      );
    }

    // Determine trainer assignment for trainees
    let assignedTrainerId: string | null = null;
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

    // Create the profile; a trainer has to activate the trainee afterwards
    await db
      .insert(profiles)
      .values({
        id: user.id,
        email: user.email || email,
        fullName: full_name,
        role,
        assignedTrainerId: assignedTrainerId ?? undefined,
        isActive: true,
        trainerActivated: false,
      })
      .onConflictDoNothing();

    if (assignedTrainerId) {
      await db
        .update(profiles)
        .set({ assignedTrainerId })
        .where(eq(profiles.id, user.id));
    }

    // Create notification for trainers when a new trainee registers
    const organizationId = await getUserOrgId(user.id);
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
        message: `${full_name} (${email}) hat sich registriert und wartet auf Freischaltung.`,
        linkUrl: '/trainer/trainees',
        isRead: false,
        organizationId,
      });
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
    // Details stay in the server log, the client only gets a generic message
    // eslint-disable-next-line no-console
    console.error('[api/register] error:', err);
    return NextResponse.json(
      {
        error:
          'Die Registrierung ist fehlgeschlagen. Bitte versuchen Sie es später erneut.',
      },
      { status: 500 }
    );
  }
}
