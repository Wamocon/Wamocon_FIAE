import { getSupabasePublicKey, getSupabaseSecretKey } from '@/lib/env';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DB_OPTION } from '@/lib/db-schema';
import { blockPreviewAccountInProduction } from '@/lib/preview-guard';
import db from '@/db';
import { profiles, organizations } from '@/db/migrations/schemas/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { takeCatalogAdminLock } from '@/lib/catalog/admin';
import { mergeProfileReferences } from '@/lib/profile-identity';

function getAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = getSupabaseSecretKey() || '';
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
    db: DB_OPTION,
  });
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

/**
 * The merge hands the enrollment (occupation) of the pre-created profile to the
 * new one. That is a catalog write, so the transaction takes the lock of the
 * catalog administration before it touches any other row. The row lock of the
 * old profile comes first (FOR NO KEY UPDATE, like updateUserChecked in
 * src/lib/admin/userWrites.ts): there the row lock precedes the seat lock, and
 * createUserRecords takes seat lock before catalog lock, so row, seat, catalog
 * is the one order of all flows. Only trainees have enrollments.
 */
async function lockForEnrollmentMove(
  tx: Parameters<typeof takeCatalogAdminLock>[0],
  oldProfileId: string
) {
  await tx.execute(
    sql`select 1 from "profiles" where "id" = ${oldProfileId} for no key update`
  );
  await takeCatalogAdminLock(tx);
}

export async function POST(request: Request) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      process.env.SUPABASE_URL_INTERNAL;
    const anonKey = getSupabasePublicKey();
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
      db: DB_OPTION,
    });

    const { data: userRes, error: userErr } = await supa.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = userRes.user;
    // An account created in Preview gets no profile in Production
    const rejected = blockPreviewAccountInProduction(user);
    if (rejected) return rejected;
    const email = (user.email || '').trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: 'Missing user email' },
        { status: 400 }
      );
    }

    // Merging attaches this login to a pre-created profile and its role, so the
    // e-mail address has to be verified first (both merge paths below).
    const emailConfirmed = Boolean(
      user.email_confirmed_at ||
      (user as { confirmed_at?: string }).confirmed_at
    );

    // Check if profile already exists
    const existingProfile = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        avatarUrl: profiles.avatarUrl,
        birthDate: profiles.birthDate,
        role: profiles.role,
        organizationId: profiles.organizationId,
        isActive: profiles.isActive,
        trainerActivated: profiles.trainerActivated,
        startOfTrainingDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
        assignedTrainerId: profiles.assignedTrainerId,
      })
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);
    const existing = existingProfile[0];

    // --- Role determination ---
    // The role comes from the database only. user_metadata.role and the
    // ADMIN_EMAIL address are client-controllable or guessable, so they never
    // grant a role. New profiles start as TRAINEE; admins promote them.
    const role: string = existing?.role ?? 'TRAINEE';

    // --- Organization assignment ---
    // Preserve the existing organization
    const organizationId: string | null = existing?.organizationId ?? null;

    // --- Activation state ---
    // Preserve existing flags. For new profiles created via self-registration:
    // - is_active defaults to true (Wamocon creates accounts as active)
    // - trainer_activated defaults to false for TRAINEE (trainer must activate)
    // - trainer_activated defaults to true for TRAINER/ADMIN/TEMP_ADMIN
    const isNewProfile = !existing;
    const trainerActivated = isNewProfile
      ? role === 'TRAINEE'
        ? false
        : true
      : existing.trainerActivated;

    const full_name =
      typeof user.user_metadata?.full_name === 'string' &&
      user.user_metadata.full_name
        ? user.user_metadata.full_name
        : deriveNameFromEmail(email);

    // Determine trainer assignment for trainees
    let assignedTrainerId: string | null =
      role === 'TRAINEE' ? (existing?.assignedTrainerId ?? null) : null;
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

    if (existing && existing.id !== user.id) {
      if (!emailConfirmed) {
        return NextResponse.json(
          { error: 'E-Mail-Adresse nicht bestätigt' },
          { status: 403 }
        );
      }
      const temporaryEmail = `profile-merge-${user.id}@local.invalid`;
      await db.transaction(async tx => {
        if (role === 'TRAINEE') await lockForEnrollmentMove(tx, existing.id);
        await tx
          .insert(profiles)
          .values({
            id: user.id,
            email: temporaryEmail,
            fullName: existing.fullName || full_name,
            firstName: existing.firstName || firstName,
            lastName: existing.lastName || lastName,
            avatarUrl: existing.avatarUrl,
            birthDate: existing.birthDate,
            role: role as any,
            organizationId,
            isActive: existing.isActive ?? true,
            trainerActivated,
            startOfTrainingDate: existing.startOfTrainingDate,
            ausbildungDurationYears: existing.ausbildungDurationYears ?? 3,
            assignedTrainerId: assignedTrainerId ?? undefined,
          })
          .onConflictDoUpdate({
            target: profiles.id,
            set: {
              email: temporaryEmail,
              role: role as any,
              organizationId,
              isActive: existing.isActive ?? true,
              trainerActivated,
              startOfTrainingDate: existing.startOfTrainingDate,
              ausbildungDurationYears: existing.ausbildungDurationYears ?? 3,
              assignedTrainerId: assignedTrainerId ?? null,
            },
          });

        await mergeProfileReferences(tx, existing.id, user.id);

        await tx.delete(profiles).where(eq(profiles.id, existing.id as any));

        await tx
          .update(profiles)
          .set({
            email,
            fullName: full_name,
            firstName,
            lastName,
            role: role as any,
            organizationId,
            isActive: true,
            trainerActivated,
            assignedTrainerId: assignedTrainerId ?? null,
            startOfTrainingDate: existing.startOfTrainingDate,
            ausbildungDurationYears: existing.ausbildungDurationYears ?? 3,
            birthDate: existing.birthDate,
            avatarUrl: existing.avatarUrl,
            updatedAt: new Date(),
          })
          .where(eq(profiles.id, user.id as any));
      });

      return NextResponse.json({ ok: true, merged: true }, { status: 200 });
    }

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
          },
        });
    } catch (drizzleErr: unknown) {
      const pgCode = (drizzleErr as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === '23505') {
        const orphan = await db
          .select({
            id: profiles.id,
            role: profiles.role,
            organizationId: profiles.organizationId,
            startOfTrainingDate: profiles.startOfTrainingDate,
            ausbildungDurationYears: profiles.ausbildungDurationYears,
            birthDate: profiles.birthDate,
            avatarUrl: profiles.avatarUrl,
            trainerActivated: profiles.trainerActivated,
            assignedTrainerId: profiles.assignedTrainerId,
          })
          .from(profiles)
          .where(and(eq(profiles.email, email), ne(profiles.id, user.id)))
          .limit(1);
        const preservedRole = orphan[0]?.role ?? role;
        if (!orphan[0]?.id) throw drizzleErr;
        // Same rule as the merge above: the pre-created profile and its role
        // are handed over only to a verified e-mail address
        if (!emailConfirmed) {
          return NextResponse.json(
            { error: 'E-Mail-Adresse nicht bestätigt' },
            { status: 403 }
          );
        }
        // The organization and the training data of the old profile are kept
        const mergedOrganizationId = orphan[0].organizationId ?? organizationId;
        // The activation and the trainer of the old profile are kept too (only
        // a trainee has a trainer), not the defaults of a new profile
        const mergedTrainerActivated =
          orphan[0].trainerActivated ?? trainerActivated;
        assignedTrainerId =
          preservedRole === 'TRAINEE'
            ? (orphan[0].assignedTrainerId ?? assignedTrainerId)
            : null;

        await db.transaction(async tx => {
          if (preservedRole === 'TRAINEE') {
            await lockForEnrollmentMove(tx, orphan[0].id);
          }
          await tx
            .insert(profiles)
            .values({
              id: user.id,
              email: `profile-merge-${user.id}@local.invalid`,
              fullName: full_name,
              firstName,
              lastName,
              role: preservedRole as any,
              assignedTrainerId: assignedTrainerId ?? undefined,
              isActive: true,
              organizationId: mergedOrganizationId,
              trainerActivated: mergedTrainerActivated,
              startOfTrainingDate: orphan[0].startOfTrainingDate,
              ausbildungDurationYears: orphan[0].ausbildungDurationYears ?? 3,
            })
            .onConflictDoNothing();
          await mergeProfileReferences(tx, orphan[0].id, user.id);
          await tx.delete(profiles).where(eq(profiles.id, orphan[0].id as any));
          await tx
            .update(profiles)
            .set({
              email,
              fullName: full_name,
              firstName,
              lastName,
              role: preservedRole as any,
              isActive: true,
              organizationId: mergedOrganizationId,
              trainerActivated: mergedTrainerActivated,
              assignedTrainerId: assignedTrainerId ?? null,
              startOfTrainingDate: orphan[0].startOfTrainingDate,
              ausbildungDurationYears: orphan[0].ausbildungDurationYears ?? 3,
              birthDate: orphan[0].birthDate,
              avatarUrl: orphan[0].avatarUrl,
            })
            .where(eq(profiles.id, user.id as any));
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
            role,
            is_active: true,
            assigned_trainer_id: assignedTrainerId,
            organization_id: organizationId,
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
