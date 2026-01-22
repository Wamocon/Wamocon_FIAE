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
    // Prefer NEXT_PUBLIC_SUPABASE_URL to ensure we validate against the same instance the client used
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || process.env.SUPABASE_URL_INTERNAL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Server misconfigured: missing Supabase URL or anon key' }, { status: 500 });
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
      return NextResponse.json({ error: 'Missing user email' }, { status: 400 });
    }

    // Determine role via allowlist (preferred) or user metadata fallback
    const allowlistCsv = (process.env.ALLOWED_TRAINER_EMAILS || process.env.NEXT_PUBLIC_ALLOWED_TRAINER_EMAILS || '').trim();
    const allowedList = allowlistCsv ? allowlistCsv.split(',').map((s: string) => s.trim().toLowerCase()) : [];
    const role = allowedList.includes(email) ? 'TRAINER' : ((user.user_metadata?.role?.toUpperCase?.() === 'TRAINER') ? 'TRAINER' : 'TRAINEE');
    const full_name = typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name
      ? user.user_metadata.full_name
      : deriveNameFromEmail(email);

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

    // Split full name for first/last name columns
    const nameParts = full_name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Upsert the profile
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
        isActive: role === 'TRAINER',
      })
      .onConflictDoNothing();

    if (role === 'TRAINEE' && assignedTrainerId) {
      await db
        .update(profiles)
        .set({ assignedTrainerId })
        .where(eq(profiles.id, user.id));
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error('[api/auth/sync-profile] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
