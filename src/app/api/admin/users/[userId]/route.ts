import { requireAdmin, isErrorResponse, scopeOrg, isInOrgScope } from '@/lib/auth/session';
import { canModifyRole } from '@/lib/auth/roles';
import { checkRoleForUpdate } from '@/lib/admin/roleAssignment';
import { updateUserChecked, userWriteFailureBody } from '@/lib/admin/userWrites';
import { getSupabaseSecretKey } from '@/lib/env';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DB_OPTION, IS_PREVIEW_SCHEMA } from '@/lib/db-schema';
import {
  deleteAuthAccountIfPreviewOnly,
  type AuthKeptReason,
} from '@/lib/preview-account';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';
import { notFoundUnlessUuid } from '@/lib/uuid';
import { PG_FOREIGN_KEY_VIOLATION, pgErrorCode } from '@/lib/pg-error';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireAdmin(req);
    if (isErrorResponse(session)) return session;

    const userNotFound = notFoundUnlessUuid(userId, 'User not found');
    if (userNotFound) return userNotFound;

    const [targetUser] = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        role: profiles.role,
        organizationId: profiles.organizationId,
      })
      .from(profiles)
      .where(eq(profiles.id, userId as any))
      .limit(1);

    // Users of other organizations are invisible to org admins
    if (
      !targetUser ||
      !isInOrgScope(scopeOrg(session), targetUser.organizationId)
    ) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Protect the ADMIN: only ADMIN can modify ADMIN, and the env-configured ADMIN cannot be demoted
    if (!canModifyRole(session, targetUser.role)) {
      return NextResponse.json(
        { error: 'Only ADMIN can modify another ADMIN' },
        { status: 403 }
      );
    }

    if (!ADMIN_EMAIL) {
      return NextResponse.json(
        { error: 'Server misconfigured: ADMIN_EMAIL not set' },
        { status: 500 }
      );
    }

    if (targetUser.email === ADMIN_EMAIL) {
      return NextResponse.json(
        { error: 'The primary admin account cannot be modified' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (typeof body.role === 'string') {
      // The caller may only hand out roles assignableRoles allows (an
      // unchanged role is no change)
      const decision = checkRoleForUpdate(session, body.role, targetUser.role);
      if (!decision.ok) {
        return NextResponse.json(
          decision.code
            ? { error: decision.error, code: decision.code }
            : { error: decision.error },
          { status: decision.status }
        );
      }
      updates.role = decision.role;
    }

    if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
    if (typeof body.trainerActivated === 'boolean') updates.trainerActivated = body.trainerActivated;
    // Moving a user to another organization is a platform-wide action
    if (
      (typeof body.organizationId === 'string' ||
        body.organizationId === null) &&
      body.organizationId !== targetUser.organizationId
    ) {
      if (!session.isSuperAdmin) {
        return NextResponse.json(
          { error: 'Only the platform admin can move users between organizations' },
          { status: 403 }
        );
      }
      updates.organizationId = body.organizationId;
    }
    if (typeof body.fullName === 'string') {
      const trimmed = body.fullName.trim();
      const parts = trimmed.split(/\s+/);
      updates.fullName = trimmed;
      updates.firstName = parts[0] || '';
      updates.lastName = parts.slice(1).join(' ') || '';
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // A change that takes a seat (a role of the other kind of seat, another
    // organization) is checked against the seats of the target organization in
    // the same transaction. Activation takes no seat: inactive accounts count.
    // The rules are checked once more under the row lock of the user (guard),
    // the reads above are only the early answer.
    const result = await updateUserChecked(userId, updates, {
      session,
      requestedRole: typeof updates.role === 'string' ? updates.role : undefined,
    });
    if (!result.ok) {
      const failure = userWriteFailureBody(result);
      return NextResponse.json(failure.body, { status: failure.status });
    }

    return NextResponse.json({ user: result.row });
  } catch (e) {
    console.error('Admin update user error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireAdmin(req);
    if (isErrorResponse(session)) return session;

    const userNotFound = notFoundUnlessUuid(userId, 'User not found');
    if (userNotFound) return userNotFound;

    if (session.id === userId) {
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
    }

    const [targetUser] = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        role: profiles.role,
        organizationId: profiles.organizationId,
      })
      .from(profiles)
      .where(eq(profiles.id, userId as any))
      .limit(1);

    // Users of other organizations are invisible to org admins
    if (
      !targetUser ||
      !isInOrgScope(scopeOrg(session), targetUser.organizationId)
    ) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!ADMIN_EMAIL) {
      return NextResponse.json(
        { error: 'Server misconfigured: ADMIN_EMAIL not set' },
        { status: 500 }
      );
    }

    if (targetUser.email === ADMIN_EMAIL) {
      return NextResponse.json(
        { error: 'The primary admin account cannot be deleted' },
        { status: 403 }
      );
    }

    if (!canModifyRole(session, targetUser.role)) {
      return NextResponse.json(
        { error: 'Only ADMIN can delete another ADMIN' },
        { status: 403 }
      );
    }

    try {
      await db.delete(profiles).where(eq(profiles.id, userId as any));
    } catch (deleteErr) {
      // A profile that others still point at cannot go: the runs of the content
      // upload (and their log) name the profiles that created, decided or applied
      // something (on delete restrict). Nothing was deleted, so the auth account
      // below stays as well.
      if (pgErrorCode(deleteErr) === PG_FOREIGN_KEY_VIOLATION) {
        return NextResponse.json(
          {
            error:
              'This account cannot be deleted because other records still refer to it, for example upload runs of the content upload. Deactivate the account instead, or remove those records first.',
            code: 'USER_IN_USE',
          },
          { status: 409 }
        );
      }
      throw deleteErr;
    }

    // Preview shares the auth of Production: the profile above lives in the
    // Preview schema and may always go, but the auth account only goes when it
    // was created in Preview (app_metadata.preview_only, read from the auth
    // server). A real, shared account stays.
    let previewKept: AuthKeptReason | 'NOT_CONFIGURED' | null =
      IS_PREVIEW_SCHEMA ? 'NOT_CONFIGURED' : null;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = getSupabaseSecretKey();
    if (supabaseUrl && serviceRoleKey) {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: DB_OPTION,
      });
      if (IS_PREVIEW_SCHEMA) {
        const outcome = await deleteAuthAccountIfPreviewOnly(
          supabaseAdmin,
          userId
        );
        previewKept = outcome.deleted ? null : outcome.reason;
      } else {
        await supabaseAdmin.auth.admin.deleteUser(userId);
      }
    }

    if (IS_PREVIEW_SCHEMA) {
      return NextResponse.json(
        previewKept
          ? {
              success: true,
              authAccountKept: true,
              authAccountKeptReason: previewKept,
            }
          : { success: true, authAccountKept: false }
      );
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Admin delete user error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
