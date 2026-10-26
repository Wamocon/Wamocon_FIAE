/**
 * Server-side session layer for API route handlers.
 *
 * The browser keeps its Supabase session in localStorage, so API calls carry
 * the access token as `Authorization: Bearer <token>` (see src/lib/authFetch.ts).
 * This module verifies that token with Supabase, loads the caller's profile and
 * organization from the database and derives the role. Identity parameters
 * sent by the client (adminId, trainerId, userId, ...) must never be trusted,
 * the session is the only source of identity.
 *
 * Usage in a route handler:
 *
 *   const session = await requireTrainer(req);
 *   if (isErrorResponse(session)) return session;
 *   // session.id, session.role, session.organizationId are now trustworthy
 */

import { getSupabasePublicKey } from '@/lib/env';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DB_OPTION, IS_PREVIEW_SCHEMA, assertDbConfig } from '@/lib/db-schema';
import { isPreviewOnlyUser } from '@/lib/preview-account';
import { createHash } from 'crypto';
import { eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import db from '@/db';
import { organizations, profiles } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import {
  isAdmin,
  isSuperAdmin,
  isTrainerLevel,
  normalizeRole,
  type Role,
} from '@/lib/auth/roles';

/** Organization used when a profile has none, same default as getUserOrgId. */
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

/** How long a verified token is trusted without asking Supabase again. */
const TOKEN_CACHE_TTL_MS = 30_000;
const TOKEN_CACHE_MAX_ENTRIES = 500;

export type SessionUser = {
  /** Auth user id, equals profiles.id. */
  id: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  /** Never null: profiles without an organization belong to the default org. */
  organizationId: string;
  isPlatformOwner: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isTrainerLevel: boolean;
};

/** The only request members this module reads, so tests can pass plain objects. */
export type RequestLike = { headers: { get(name: string): string | null } };

type AuthFailure = {
  ok: false;
  status: 401 | 403 | 500 | 503;
  error: string;
};
export type AuthResult = { ok: true; session: SessionUser } | AuthFailure;

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

type VerifiedToken = {
  id: string;
  email: string | null;
  /** The account was created in Preview (app_metadata.preview_only). */
  previewOnly: boolean;
};
const tokenCache = new Map<
  string,
  { user: VerifiedToken; expiresAt: number }
>();

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** Test helper: forget all cached token verifications. */
export function clearSessionCache() {
  tokenCache.clear();
}

export function extractBearerToken(request: RequestLike): string | null {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

async function verifyAccessToken(
  token: string
): Promise<VerifiedToken | AuthFailure> {
  const key = hashToken(token);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  if (cached) tokenCache.delete(key);

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_URL_INTERNAL;
  const anonKey = getSupabasePublicKey();
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      status: 500,
      error: 'Server misconfigured: missing Supabase URL or anon key',
    };
  }

  try {
    // The database role of this deployment has to fit the schema
    assertDbConfig();
    const supa = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: DB_OPTION,
    });
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user?.id) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
    const user: VerifiedToken = {
      id: data.user.id,
      email: data.user.email ?? null,
      previewOnly: isPreviewOnlyUser(data.user),
    };
    if (tokenCache.size >= TOKEN_CACHE_MAX_ENTRIES) tokenCache.clear();
    tokenCache.set(key, { user, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
    return user;
  } catch (err) {
    console.error('[session] token verification failed:', err);
    return { ok: false, status: 503, error: 'Authentication unavailable' };
  }
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

/**
 * Verify the bearer token and load the caller's profile. Returns the session
 * or the reason it could not be established.
 */
export async function authenticate(request: RequestLike): Promise<AuthResult> {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, status: 401, error: 'Unauthorized' };

  const verified = await verifyAccessToken(token);
  if ('ok' in verified) return verified;

  // An account created in Preview is no real user of Production (shared auth)
  if (verified.previewOnly && !IS_PREVIEW_SCHEMA) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  let row;
  try {
    [row] = await withDbRetry(() =>
      db
        .select({
          id: profiles.id,
          email: profiles.email,
          fullName: profiles.fullName,
          role: profiles.role,
          organizationId: profiles.organizationId,
          isActive: profiles.isActive,
          orgIsActive: organizations.isActive,
          isPlatformOwner: organizations.isPlatformOwner,
        })
        .from(profiles)
        .leftJoin(organizations, eq(profiles.organizationId, organizations.id))
        .where(eq(profiles.id, verified.id as any))
        .limit(1)
    );
  } catch (err) {
    console.error('[session] profile lookup failed:', err);
    return { ok: false, status: 503, error: 'Authentication unavailable' };
  }

  if (!row) return { ok: false, status: 403, error: 'Forbidden' };
  if (row.isActive === false || row.orgIsActive === false) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const role = normalizeRole(row.role);
  if (!role) return { ok: false, status: 403, error: 'Forbidden' };

  const subject = { role, isPlatformOwner: row.isPlatformOwner === true };
  return {
    ok: true,
    session: {
      id: String(row.id),
      email: row.email ?? verified.email,
      fullName: row.fullName ?? null,
      role,
      organizationId: row.organizationId
        ? String(row.organizationId)
        : DEFAULT_ORG_ID,
      isPlatformOwner: subject.isPlatformOwner,
      isSuperAdmin: isSuperAdmin(subject),
      isAdmin: isAdmin(subject),
      isTrainerLevel: isTrainerLevel(subject),
    },
  };
}

/** The session of the caller, or null if there is none. */
export async function getSessionUser(
  request: RequestLike
): Promise<SessionUser | null> {
  const result = await authenticate(request);
  return result.ok ? result.session : null;
}

function failureResponse(failure: AuthFailure) {
  return NextResponse.json(
    { error: failure.error },
    { status: failure.status }
  );
}

/** True when a require* helper returned a ready-made error response. */
export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof Response;
}

/** Any authenticated, active user. */
export async function requireUser(
  request: RequestLike
): Promise<SessionUser | NextResponse> {
  const result = await authenticate(request);
  return result.ok ? result.session : failureResponse(result);
}

/** Trainer or any admin level (SUPER_ADMIN, ADMIN, TEMP_ADMIN). */
export async function requireTrainer(
  request: RequestLike
): Promise<SessionUser | NextResponse> {
  const result = await authenticate(request);
  if (!result.ok) return failureResponse(result);
  if (!result.session.isTrainerLevel) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return result.session;
}

/** SUPER_ADMIN, ADMIN or TEMP_ADMIN. */
export async function requireAdmin(
  request: RequestLike
): Promise<SessionUser | NextResponse> {
  const result = await authenticate(request);
  if (!result.ok) return failureResponse(result);
  if (!result.session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return result.session;
}

/** Platform-wide administrator only. */
export async function requireSuperAdmin(
  request: RequestLike
): Promise<SessionUser | NextResponse> {
  const result = await authenticate(request);
  if (!result.ok) return failureResponse(result);
  if (!result.session.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return result.session;
}

/** Answer of the curriculum write handlers to a caller without the right. */
export const CURRICULUM_WRITE_FORBIDDEN =
  'Only platform administrators can manage curriculum content';

/**
 * Guard of every write handler (POST, PUT, PATCH, DELETE) on curriculum
 * content: courses, enablers, use cases, quizzes, learning fields, modules,
 * lessons and the assignments between them. Only the platform wide admin
 * passes (SUPER_ADMIN, or an ADMIN of the platform organization, see
 * isSuperAdmin). A trainer or TEMP_ADMIN of the platform organization and
 * everybody in a customer organization is answered with 403. Role and
 * organization come from the database row of the session, never from the
 * request. Reading stays with requireTrainer.
 */
export async function requireCurriculumEditor(
  request: RequestLike
): Promise<SessionUser | NextResponse> {
  const result = await authenticate(request);
  if (!result.ok) return failureResponse(result);
  if (!result.session.isSuperAdmin) {
    return NextResponse.json(
      { error: CURRICULUM_WRITE_FORBIDDEN },
      { status: 403 }
    );
  }
  return result.session;
}

// ---------------------------------------------------------------------------
// Organization scope
// ---------------------------------------------------------------------------

export type OrgScope = {
  /** The organization to restrict to, or null for all organizations. */
  organizationId: string | null;
  /** True for the platform-wide view (organizationId is null). */
  isGlobal: boolean;
};

/**
 * Which organizations the caller may see. SUPER_ADMIN is global by default and
 * may narrow the view with `requestedOrgId`. Everyone else is always limited
 * to their own organization, a requested one is ignored.
 */
export function scopeOrg(
  session: SessionUser,
  requestedOrgId?: string | null
): OrgScope {
  if (session.isSuperAdmin) {
    const organizationId = requestedOrgId ? String(requestedOrgId) : null;
    return { organizationId, isGlobal: organizationId === null };
  }
  return { organizationId: session.organizationId, isGlobal: false };
}

/** Drizzle condition for an organization column, undefined means no filter. */
export function orgScopeCondition(
  column: PgColumn,
  scope: OrgScope
): SQL | undefined {
  return scope.organizationId === null
    ? undefined
    : eq(column, scope.organizationId as any);
}

/**
 * Whether an entity of `organizationId` lies inside the caller's scope. Fail
 * closed: a row without an organization belongs to nobody, only the
 * platform-wide view (organizationId null, super admin) reaches it. This is
 * the same rule as orgScopeCondition, which leaves such a row out of every
 * list. (A profile without an organization still gets DEFAULT_ORG_ID as the
 * organization of its own SESSION, see authenticate.)
 */
export function isInOrgScope(
  scope: OrgScope,
  organizationId: string | null | undefined
): boolean {
  if (scope.organizationId === null) return true;
  if (organizationId === null || organizationId === undefined) return false;
  const value = String(organizationId);
  return value !== '' && value === scope.organizationId;
}
