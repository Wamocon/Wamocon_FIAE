import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/db';
import { eq, sql } from 'drizzle-orm';
import { profiles, organizations, notifications } from '@/db/migrations/schemas/schema';
import { verifyAdmin } from '@/lib/auth-helpers';
import { sendCredentialsEmail } from '@/lib/email';
import crypto from 'crypto';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const adminId = searchParams.get('adminId');
    if (!adminId || !(await verifyAdmin(adminId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const orgFilter = searchParams.get('orgId');

    const rows = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
        avatarUrl: profiles.avatarUrl,
        role: profiles.role,
        isActive: profiles.isActive,
        trainerActivated: profiles.trainerActivated,
        organizationId: profiles.organizationId,
        createdAt: profiles.createdAt,
        orgName: organizations.name,
        orgSlug: organizations.slug,
      })
      .from(profiles)
      .leftJoin(organizations, eq(profiles.organizationId, organizations.id))
      .where(orgFilter ? eq(profiles.organizationId, orgFilter as any) : sql`1=1`)
      .orderBy(profiles.createdAt);

    return NextResponse.json({
      users: rows.map(r => ({
        id: r.id,
        fullName: r.fullName,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        avatarUrl: r.avatarUrl,
        role: r.role,
        isActive: r.isActive,
        trainerActivated: r.trainerActivated,
        organizationId: r.organizationId,
        orgName: r.orgName,
        orgSlug: r.orgSlug,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    console.error('Admin list users error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const adminId = searchParams.get('adminId');
    if (!adminId || !(await verifyAdmin(adminId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { email, fullName, role, organizationId, sendEmail } = body as {
      email: string;
      fullName: string;
      role: string;
      organizationId: string;
      sendEmail?: boolean;
    };

    if (!email || !fullName || !role || !organizationId) {
      return NextResponse.json(
        { error: 'email, fullName, role, and organizationId are required' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const validRoles = ['TEMP_ADMIN', 'TRAINER', 'TRAINEE'];
    const upperRole = role.toUpperCase();
    if (!validRoles.includes(upperRole)) {
      return NextResponse.json({ error: 'Invalid role. Use TEMP_ADMIN, TRAINER, or TRAINEE.' }, { status: 400 });
    }

    // Verify org exists
    const [org] = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId as any))
      .limit(1);
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Check for existing user with same email
    const existingProfile = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, email.trim().toLowerCase()))
      .limit(1);
    if (existingProfile.length > 0) {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_URL_INTERNAL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const password = generatePassword();

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: upperRole },
    });

    if (createError) {
      return NextResponse.json(
        { error: (createError as any)?.message || 'Failed to create auth user' },
        { status: 400 }
      );
    }

    const user = created.user;
    if (!user?.id) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }

    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    await db
      .insert(profiles)
      .values({
        id: user.id,
        email: email.trim().toLowerCase(),
        fullName: fullName.trim(),
        firstName,
        lastName,
        role: upperRole as any,
        organizationId: organizationId as any,
        isActive: true,
        trainerActivated: upperRole !== 'TRAINEE',
      })
      .onConflictDoNothing();

    // Send credentials email
    let emailSent = false;
    if (sendEmail !== false) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      const result = await sendCredentialsEmail(
        email.trim(),
        fullName.trim(),
        password,
        `${appUrl}/login`
      );
      emailSent = result.success;
    }

    // Notify org trainers about new trainee
    if (upperRole === 'TRAINEE') {
      const orgTrainers = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(
          sql`${profiles.organizationId} = ${organizationId} AND ${profiles.role} IN ('TRAINER', 'TEMP_ADMIN', 'ADMIN') AND ${profiles.isActive} = true`
        );

      for (const trainer of orgTrainers) {
        await db.insert(notifications).values({
          userId: trainer.id,
          actorId: user.id,
          type: 'TRAINEE_REGISTERED',
          title: 'Neuer Azubi hinzugefügt',
          message: `${fullName} (${email.trim()}) wurde als Azubi hinzugefügt und wartet auf Freischaltung.`,
          linkUrl: '/trainer/trainees',
          isRead: false,
          organizationId: organizationId as any,
        });
      }
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: email.trim(),
        fullName: fullName.trim(),
        role: upperRole,
        organizationId,
        orgName: org.name,
      },
      credentials: { email: email.trim(), password },
      emailSent,
    }, { status: 201 });
  } catch (e) {
    console.error('Admin create user error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
