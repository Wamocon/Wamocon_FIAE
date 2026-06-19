import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/db';
import { profiles, organizations } from '@/db/migrations/schemas/schema';
import { and, eq, ne } from 'drizzle-orm';

const WAMOCON_ORG_ID = '00000000-0000-0000-0000-000000000001';

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

function isAdminEmail(email: string): boolean {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  return !!adminEmail && email === adminEmail;
}

export async function POST(request: Request) {
  try {
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

    // Check if profile already exists
    const existingProfile = await db
      .select({
        id: profiles.id,
        role: profiles.role,
        organizationId: profiles.organizationId,
        isActive: profiles.isActive,
        trainerActivated: profiles.trainerActivated,
      })
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);

    // --- Role determination ---
    // Priority: ADMIN_EMAIL env > existing DB role > user metadata > TRAINEE default
    let role: string;
    if (isAdminEmail(email)) {
      role = 'ADMIN';
    } else if (existingProfile[0]?.role) {
      role = existingProfile[0].role;
    } else {
      const metaRole = user.user_metadata?.role?.toUpperCase?.();
      role = metaRole === 'TRAINER' ? 'TRAINER' : 'TRAINEE';
    }

    // --- Organization assignment ---
    // Preserve existing org; ADMIN_EMAIL always belongs to wamocon org
    let organizationId: string | null = existingProfile[0]?.organizationId ?? null;
    if (isAdminEmail(email) && !organizationId) {
      organizationId = WAMOCON_ORG_ID;
    }

    // --- Activation state ---
    // Preserve existing flags. For new profiles created via self-registration:
    // - is_active defaults to true (Wamocon creates accounts as active)
    // - trainer_activated defaults to false for TRAINEE (trainer must activate)
    // - trainer_activated defaults to true for TRAINER/ADMIN/TEMP_ADMIN
    const isNewProfile = !existingProfile[0];
    const trainerActivated = isNewProfile
      ? role === 'TRAINEE' ? false : true
      : existingProfile[0].trainerActivated;

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
        // Fall back to any trainer in the same org, or any trainer
        if (organizationId) {
          const orgTrainers = await db
            .select({ id: profiles.id })
            .from(profiles)
            .where(
              and(
                eq(profiles.organizationId, organizationId),
                eq(profiles.role, 'TRAINER')
              )
            )
            .limit(1);
          assignedTrainerId = orgTrainers[0]?.id ?? null;
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
    }

    const nameParts = full_name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Upsert the profile
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
          organizationId,
          trainerActivated,
        })
        .onConflictDoUpdate({
          target: profiles.id,
          set: {
            email,
            fullName: full_name,
            firstName,
            lastName,
            ...(isAdminEmail(email)
              ? { role: 'ADMIN' as any, organizationId: WAMOCON_ORG_ID }
              : {}),
          },
        });
    } catch (drizzleErr: unknown) {
      const pgCode = (drizzleErr as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === '23505') {
        const orphan = await db
          .select({ role: profiles.role })
          .from(profiles)
          .where(and(eq(profiles.email, email), ne(profiles.id, user.id)))
          .limit(1);
        const preservedRole = isAdminEmail(email)
          ? 'ADMIN'
          : (orphan[0]?.role ?? role);
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
            role: preservedRole as any,
            assignedTrainerId: assignedTrainerId ?? undefined,
            isActive: true,
            organizationId: isAdminEmail(email) ? WAMOCON_ORG_ID : organizationId,
            trainerActivated,
          })
          .onConflictDoUpdate({
            target: profiles.id,
            set: {
              email,
              fullName: full_name,
              firstName,
              lastName,
              isActive: true,
            },
          });
      } else if (pgCode === '23503') {
        const admin = getAdminClient();
        const { error: upsertErr } = await admin.from('profiles').upsert(
          {
            id: user.id,
            email,
            full_name,
            first_name: firstName,
            last_name: lastName,
            role: isAdminEmail(email) ? 'ADMIN' : role,
            is_active: true,
            assigned_trainer_id: assignedTrainerId,
            organization_id: isAdminEmail(email) ? WAMOCON_ORG_ID : organizationId,
            trainer_activated: trainerActivated,
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
        const admin = getAdminClient();
        await admin
          .from('profiles')
          .update({ assigned_trainer_id: assignedTrainerId })
          .eq('id', user.id);
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    console.error('[api/auth/sync-profile] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
