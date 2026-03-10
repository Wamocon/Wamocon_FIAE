import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';
import { verifyAdmin } from '@/lib/auth-helpers';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const { searchParams } = new URL(req.url);
    const adminId = searchParams.get('adminId');
    if (!adminId || !(await verifyAdmin(adminId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const [targetUser] = await db
      .select({ id: profiles.id, email: profiles.email, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId as any))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Protect the ADMIN: only ADMIN can modify ADMIN, and the env-configured ADMIN cannot be demoted
    const [callerProfile] = await db
      .select({ role: profiles.role, email: profiles.email })
      .from(profiles)
      .where(eq(profiles.id, adminId as any))
      .limit(1);

    const callerRole = callerProfile?.role?.toUpperCase();
    const targetRole = targetUser.role?.toUpperCase();

    if (targetRole === 'ADMIN' && callerRole !== 'ADMIN') {
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
      if (callerRole === 'TEMP_ADMIN' && newRole === 'ADMIN') {
        return NextResponse.json(
          { error: 'TEMP_ADMIN cannot promote users to ADMIN' },
          { status: 403 }
        );
      }
      updates.role = newRole;
    }

    if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
    if (typeof body.trainerActivated === 'boolean') updates.trainerActivated = body.trainerActivated;
    if (typeof body.organizationId === 'string') updates.organizationId = body.organizationId;
    if (body.organizationId === null) updates.organizationId = null;
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
    const { searchParams } = new URL(req.url);
    const adminId = searchParams.get('adminId');
    if (!adminId || !(await verifyAdmin(adminId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (adminId === userId) {
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
    }

    const [targetUser] = await db
      .select({ id: profiles.id, email: profiles.email, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId as any))
      .limit(1);

    if (!targetUser) {
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

    const [callerProfile] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, adminId as any))
      .limit(1);

    const callerRole = callerProfile?.role?.toUpperCase();
    const targetRole = targetUser.role?.toUpperCase();

    if (targetRole === 'ADMIN' && callerRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only ADMIN can delete another ADMIN' },
        { status: 403 }
      );
    }

    await db.delete(profiles).where(eq(profiles.id, userId as any));

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceRoleKey) {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await supabaseAdmin.auth.admin.deleteUser(userId);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Admin delete user error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
