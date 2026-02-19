import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/db';
import { profiles } from '@/db/migrations/schemas/schema';
import { and, eq, ne } from 'drizzle-orm';

function getAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, serviceKey, { auth: { persistSession: false } });
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
    // Prefer NEXT_PUBLIC_SUPABASE_URL to ensure we validate against the same instance the client used
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      process.env.SUPABASE_URL_INTERNAL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing Supabase URL or anon key' },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get('authorization') || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    const accessToken = m?.[1];
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supa = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await supa.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = userRes.user;
    const email = (user.email || '').trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: 'Missing user email' },
        { status: 400 }
      );
    }

    // Determine role via allowlist (preferred) or user metadata fallback
    const allowlistCsv = (
      process.env.ALLOWED_TRAINER_EMAILS ||
      process.env.NEXT_PUBLIC_ALLOWED_TRAINER_EMAILS ||
      ''
    ).trim();
    const allowedList = allowlistCsv
      ? allowlistCsv.split(',').map((s: string) => s.trim().toLowerCase())
      : [];
    const role = allowedList.includes(email)
      ? 'TRAINER'
      : user.user_metadata?.role?.toUpperCase?.() === 'TRAINER'
        ? 'TRAINER'
        : 'TRAINEE';
    const full_name =
      typeof user.user_metadata?.full_name === 'string' &&
      user.user_metadata.full_name
        ? user.user_metadata.full_name
        : deriveNameFromEmail(email);

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

    // Split full name for first/last name columns
    const nameParts = full_name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Upsert the profile — use Drizzle first, fall back to Supabase admin client
    // if the pooler connection can't verify the auth.users FK constraint
    try {
      await db
        .insert(profiles)
        .values({
          id: user.id,
          email,
          fullName: full_name,
          firstName,
          lastName,
          role: role as any,
          assignedTrainerId: assignedTrainerId ?? undefined,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: profiles.id,
          set: {
            email,
            fullName: full_name,
            firstName,
            lastName,
            role: role as any,
            isActive: true,
          },
        });
    } catch (drizzleErr: unknown) {
      const pgCode = (drizzleErr as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === '23505') {
        // Unique constraint violation on email — an orphaned profile with the
        // same email but a different id exists.  Remove the orphan and retry.
        await db
          .delete(profiles)
          .where(and(eq(profiles.email, email), ne(profiles.id, user.id)));
        await db
          .insert(profiles)
          .values({
            id: user.id,
            email,
            fullName: full_name,
            firstName,
            lastName,
            role: role as any,
            assignedTrainerId: assignedTrainerId ?? undefined,
            isActive: true,
          })
          .onConflictDoUpdate({
            target: profiles.id,
            set: {
              email,
              fullName: full_name,
              firstName,
              lastName,
              role: role as any,
              isActive: true,
            },
          });
      } else if (pgCode === '23503') {
        // FK violation — pooler can't see auth.users; fall back to admin client
        const admin = getAdminClient();
        const { error: upsertErr } = await admin.from('profiles').upsert(
          {
            id: user.id,
            email,
            full_name,
            first_name: firstName,
            last_name: lastName,
            role,
            is_active: true,
            assigned_trainer_id: assignedTrainerId,
          },
          { onConflict: 'id' }
        );
        if (upsertErr) throw upsertErr;
      } else {
        throw drizzleErr;
      }
    }

    if (role === 'TRAINEE' && assignedTrainerId) {
      try {
        await db
          .update(profiles)
          .set({ assignedTrainerId })
          .where(eq(profiles.id, user.id));
      } catch {
        // Fallback to admin client for update as well
        const admin = getAdminClient();
        await admin
          .from('profiles')
          .update({ assigned_trainer_id: assignedTrainerId })
          .eq('id', user.id);
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error('[api/auth/sync-profile] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
