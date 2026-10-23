import { requireAdmin, isErrorResponse, scopeOrg, isInOrgScope } from '@/lib/auth/session';
import { canManageAdmins, canModifyRole } from '@/lib/auth/roles';
import { getSupabaseSecretKey } from '@/lib/env';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DB_OPTION } from '@/lib/db-schema';
import { blockInPreview } from '@/lib/preview-guard';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';

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
      const newRole = body.role.toUpperCase();
      const validRoles = ['ADMIN', 'TEMP_ADMIN', 'TRAINER', 'TRAINEE'];
      if (!validRoles.includes(newRole)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }
      // TEMP_ADMIN cannot promote to ADMIN or modify ADMIN users
      if (newRole === 'ADMIN' && !canManageAdmins(session)) {
        return NextResponse.json(
          { error: 'TEMP_ADMIN cannot promote users to ADMIN' },
          { status: 403 }
        );
      }
      updates.role = newRole;
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

    const [row] = await db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.id, userId as any))
      .returning({
        id: profiles.id,
        fullName: profiles.fullName,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
        role: profiles.role,
        isActive: profiles.isActive,
        trainerActivated: profiles.trainerActivated,
        organizationId: profiles.organizationId,
      });

    return NextResponse.json({ user: row });
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

    // auth.admin.deleteUser would delete an account of the shared Production auth
    const blocked = blockInPreview();
    if (blocked) return blocked;

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

    await db.delete(profiles).where(eq(profiles.id, userId as any));

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = getSupabaseSecretKey();
    if (supabaseUrl && serviceRoleKey) {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: DB_OPTION,
      });
      await supabaseAdmin.auth.admin.deleteUser(userId);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Admin delete user error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
