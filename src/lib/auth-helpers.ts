/**
 * Shared Authorization Helpers
 *
 * Multi-tenant role hierarchy:
 *   ADMIN > TEMP_ADMIN > TRAINER > TRAINEE
 *
 * Platform-owner (Wamocon) trainers manage shared curriculum.
 * Customer-org trainers manage only their org's supplementary content.
 */

import db from '@/db';
import { eq, and } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { profiles, organizations } from '@/db/migrations/schemas/schema';

const PRIVILEGED_ROLES = ['ADMIN', 'TEMP_ADMIN', 'TRAINER'] as const;
const ADMIN_ROLES = ['ADMIN', 'TEMP_ADMIN'] as const;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Verify the user has a privileged role (ADMIN, TEMP_ADMIN, or TRAINER).
 * Replaces the old verifyTrainer — any of these roles can access trainer-level APIs.
 */
export async function verifyTrainer(userId: string): Promise<boolean> {
  if (!userId) return false;

  try {
    const [row] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId as any));

    if (row && PRIVILEGED_ROLES.includes(row.role as any)) return true;

    if (!row) {
      const admin = getAdminClient();
      const { data } = await admin
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
      return !!data && PRIVILEGED_ROLES.includes(data.role);
    }
    return false;
  } catch (error) {
    console.error('Error verifying trainer:', error);
    return false;
  }
}

/**
 * Verify the user is an ADMIN or TEMP_ADMIN.
 */
export async function verifyAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;

  try {
    const [row] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId as any));

    if (row && ADMIN_ROLES.includes(row.role as any)) return true;

    if (!row) {
      const admin = getAdminClient();
      const { data } = await admin
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
      return !!data && ADMIN_ROLES.includes(data.role);
    }
    return false;
  } catch (error) {
    console.error('Error verifying admin:', error);
    return false;
  }
}

/**
 * Verify the user belongs to the platform-owner organization (Wamocon).
 */
export async function verifyPlatformOwner(userId: string): Promise<boolean> {
  if (!userId) return false;

  try {
    const [row] = await db
      .select({
        orgId: profiles.organizationId,
        isPlatformOwner: organizations.isPlatformOwner,
      })
      .from(profiles)
      .leftJoin(organizations, eq(profiles.organizationId, organizations.id))
      .where(eq(profiles.id, userId as any));

    return row?.isPlatformOwner === true;
  } catch (error) {
    console.error('Error verifying platform owner:', error);
    return false;
  }
}

/**
 * Verify the requesting user is a valid TRAINEE in the system.
 */
export async function verifyTrainee(traineeId: string): Promise<boolean> {
  if (!traineeId) return false;

  try {
    const [trainee] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, traineeId as any));

    if (trainee?.role === 'TRAINEE') return true;

    if (!trainee) {
      const admin = getAdminClient();
      const { data } = await admin
        .from('profiles')
        .select('role')
        .eq('id', traineeId)
        .single();
      return data?.role === 'TRAINEE';
    }
    return false;
  } catch (error) {
    console.error('Error verifying trainee:', error);
    return false;
  }
}

/**
 * Get user profile by ID.
 */
export async function getProfile(userId: string) {
  if (!userId) return null;

  try {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId as any));

    return profile || null;
  } catch (error) {
    console.error('Error getting profile:', error);
    return null;
  }
}

/**
 * Get user profile along with their organization details.
 */
export async function getProfileWithOrg(userId: string) {
  if (!userId) return null;

  try {
    const [row] = await db
      .select({
        profile: profiles,
        org: organizations,
      })
      .from(profiles)
      .leftJoin(organizations, eq(profiles.organizationId, organizations.id))
      .where(eq(profiles.id, userId as any));

    if (!row) return null;
    return { profile: row.profile, organization: row.org };
  } catch (error) {
    console.error('Error getting profile with org:', error);
    return null;
  }
}

export const WAMOCON_ORG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Resolve a user's organization_id from their profile.
 * Falls back to the Wamocon org if the user has no org assigned.
 */
export async function getUserOrgId(userId: string): Promise<string> {
  if (!userId) {
    console.warn('[getUserOrgId] called with empty userId, defaulting to WAMOCON_ORG_ID');
    return WAMOCON_ORG_ID;
  }
  try {
    const [row] = await db
      .select({ organizationId: profiles.organizationId })
      .from(profiles)
      .where(eq(profiles.id, userId as any));
    if (!row) {
      console.warn(`[getUserOrgId] no profile found for userId=${userId}, defaulting to WAMOCON_ORG_ID`);
      return WAMOCON_ORG_ID;
    }
    if (!row.organizationId) {
      console.warn(`[getUserOrgId] profile ${userId} has no organizationId, defaulting to WAMOCON_ORG_ID`);
    }
    return row.organizationId ?? WAMOCON_ORG_ID;
  } catch (err) {
    console.error('[getUserOrgId] error:', err);
    return WAMOCON_ORG_ID;
  }
}

/**
 * Get the subscription plan for a user's organization.
 * Platform owner (Wamocon) always returns 'PRO'.
 */
export async function getUserSubscriptionPlan(
  userId: string
): Promise<'LIGHT' | 'PRO'> {
  if (!userId) return 'LIGHT';
  try {
    const data = await getProfileWithOrg(userId);
    if (!data?.organization) return 'LIGHT';
    if (data.organization.isPlatformOwner) return 'PRO';
    return (data.organization.subscriptionPlan as 'LIGHT' | 'PRO') ?? 'LIGHT';
  } catch {
    return 'LIGHT';
  }
}

/**
 * Verify user has PRO subscription (or belongs to platform-owner org).
 */
export async function requireProPlan(userId: string): Promise<boolean> {
  const plan = await getUserSubscriptionPlan(userId);
  return plan === 'PRO';
}

/**
 * Check whether a user's org is active AND the user themselves are active.
 * Returns { allowed: boolean; reason?: string }.
 */
export async function checkAccessGates(userId: string): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const data = await getProfileWithOrg(userId);
  if (!data) return { allowed: false, reason: 'Profile not found' };

  const { profile: p, organization: org } = data;

  if (p.isActive === false) {
    return { allowed: false, reason: 'Account deactivated by Wamocon' };
  }

  if (!org) {
    return { allowed: false, reason: 'No organization assigned' };
  }

  if (org.isActive === false) {
    return { allowed: false, reason: 'Organization is deactivated' };
  }

  if (p.role === 'TRAINEE' && p.trainerActivated === false) {
    return { allowed: false, reason: 'Awaiting trainer activation' };
  }

  return { allowed: true };
}
