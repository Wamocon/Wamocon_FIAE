import { getSupabasePublicKey } from '@/lib/env';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DB_OPTION } from '@/lib/db-schema';
import { blockInPreview } from '@/lib/preview-guard';
import { passwordProblem } from '@/lib/auth/password-policy';
import {
  confirmationRedirectUrl,
  isEmailRateLimitError,
} from '@/lib/auth/email-confirmation';
import db from '@/db';
import { profiles, notifications } from '@/db/migrations/schemas/schema';
import { and, eq } from 'drizzle-orm';
import { getUserOrgId } from '@/lib/auth-helpers';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

// Public endpoint: at most 5 registrations per client address per hour
const REGISTER_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALREADY_REGISTERED_MESSAGE =
  'Diese E-Mail-Adresse ist bereits registriert. Bitte melden Sie sich an.';

type SignUpFailure = { status: number; message: string };

/**
 * Maps the error of auth.signUp to a status and a German message. The raw
 * message of Supabase never reaches the client.
 */
function signUpFailure(error: unknown): SignUpFailure {
  const { status, code, message } = (error ?? {}) as {
    status?: number;
    code?: string;
    message?: string;
  };
  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    /already.*(registered|exists)/i.test(message || '')
  ) {
    return { status: 409, message: ALREADY_REGISTERED_MESSAGE };
  }
  if (code === 'weak_password') {
    return {
      status: 400,
      message:
        'Das Passwort wird nicht akzeptiert. Bitte wählen Sie ein anderes, längeres Passwort.',
    };
  }
  if (isEmailRateLimitError(error)) {
    return {
      status: 429,
      message:
        'Zurzeit können keine weiteren E-Mails verschickt werden. Bitte versuchen Sie es in einigen Minuten erneut.',
    };
  }
  if (code === 'signup_disabled') {
    return {
      status: 503,
      message:
        'Die Selbstregistrierung ist zurzeit nicht möglich. Bitte wenden Sie sich an Ihren Ausbilder.',
    };
  }
  if (code === 'email_address_invalid') {
    return {
      status: 400,
      message: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
    };
  }
  return {
    status: status && status >= 400 && status < 500 ? status : 400,
    message:
      'Die Registrierung ist fehlgeschlagen. Bitte versuchen Sie es erneut.',
  };
}

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
    // A sign up in Preview would create an account in the shared Production auth
    const blocked = blockInPreview();
    if (blocked) return blocked;

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
    const problem = passwordProblem(password);
    if (problem) {
      return NextResponse.json({ error: `${problem}.` }, { status: 400 });
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
        { error: ALREADY_REGISTERED_MESSAGE },
        { status: 409 }
      );
    }

    // Self-registration always creates a TRAINEE. Higher roles are assigned
    // by admins only, never derived from the request or from the email.
    const role = 'TRAINEE';
    const full_name = deriveNameFromEmail(email);

    // A normal sign up with the public key (no auth.admin): whether the person
    // has to confirm the address is decided by the "Confirm email" setting of
    // Supabase Auth. With it on, Supabase sends the confirmation e-mail and
    // answers without a session; with it off, the account is confirmed at once
    // and the answer carries a session. The session is not used, the person
    // signs in on the login page in both cases.
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: DB_OPTION,
    });

    const { data: signedUp, error: signUpError } = await authClient.auth.signUp(
      {
        email,
        password,
        options: {
          data: { full_name },
          emailRedirectTo: confirmationRedirectUrl(request.headers),
        },
      }
    );

    if (signUpError) {
      const failure = signUpFailure(signUpError);
      return NextResponse.json(
        { error: failure.message },
        { status: failure.status }
      );
    }

    const user = signedUp.user;
    if (!user?.id) {
      return NextResponse.json(
        { error: 'Der Benutzer konnte nicht angelegt werden.' },
        { status: 500 }
      );
    }

    // With "Confirm email" on, Supabase does not report an address that is
    // already confirmed as an error. It answers with a made-up user without
    // identities instead, which must not get a profile.
    if (Array.isArray(user.identities) && user.identities.length === 0) {
      return NextResponse.json(
        { error: ALREADY_REGISTERED_MESSAGE },
        { status: 409 }
      );
    }

    // No session and no confirmation yet: the person has to click the link
    const confirmationRequired = !signedUp.session && !user.email_confirmed_at;

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
        message: confirmationRequired
          ? `${full_name} (${email}) hat sich registriert und wartet auf Freischaltung. Die E-Mail-Adresse ist noch nicht bestätigt.`
          : `${full_name} (${email}) hat sich registriert und wartet auf Freischaltung.`,
        linkUrl: '/trainer/trainees',
        isRead: false,
        organizationId,
      });
    }

    return NextResponse.json(
      {
        success: true,
        role,
        confirmationRequired,
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
