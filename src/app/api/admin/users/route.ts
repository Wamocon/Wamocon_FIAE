import { syncTraineeContentAfterEnrollment } from '@/lib/catalog/trainee-content';
import {
  requireAdmin,
  isErrorResponse,
  scopeOrg,
  orgScopeCondition,
} from '@/lib/auth/session';
import { getSupabaseSecretKey } from '@/lib/env';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TRAINER_LEVEL_ROLES, normalizeRole, ROLE } from '@/lib/auth/roles';
import {
  getTrainingCatalogCodeLists,
  isUuid,
  ruleFailureBody,
} from '@/lib/catalog/admin';
import { checkRoleForCreate } from '@/lib/admin/roleAssignment';
import {
  checkNewUser,
  createUserRecords,
  userWriteFailureBody,
} from '@/lib/admin/userWrites';
import { profiles, organizations, notifications } from '@/db/migrations/schemas/schema';
import { sendCredentialsEmail } from '@/lib/email';
import { DB_OPTION } from '@/lib/db-schema';
import {
  createUserFailureMessage,
  previewAccountAppMetadata,
  shouldSendCredentialsEmail,
} from '@/lib/preview-account';
import crypto from 'crypto';

export async function GET(req: NextRequest) {
  try {
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireAdmin(req);
    if (isErrorResponse(session)) return session;

    // Org admins only see their own organization, the super admin sees all
    // and may narrow the list with ?orgId=
    const { searchParams } = new URL(req.url);
    const scope = scopeOrg(session, searchParams.get('orgId'));

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
      .where(orgScopeCondition(profiles.organizationId, scope) ?? sql`1=1`)
      .orderBy(profiles.createdAt);

    // The occupation of every trainee comes from its own lookup over the
    // trainee ids (no join). The list works without it, so a failing lookup
    // is only logged and leaves the code empty.
    let catalogCodes = new Map<string, string[]>();
    try {
      catalogCodes = await getTrainingCatalogCodeLists(
        rows
          .filter(r => normalizeRole(r.role) === ROLE.TRAINEE)
          .map(r => String(r.id))
      );
    } catch (err) {
      console.error('Admin list users: catalog lookup failed', err);
    }

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
        // The first enrollment, and all of them (a trainee can have several)
        trainingCatalogCode: catalogCodes.get(String(r.id))?.[0] ?? null,
        trainingCatalogCodes: catalogCodes.get(String(r.id)) ?? null,
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

/**
 * Remove the auth account of a user whose records could not be written. A
 * failure is only logged: the answer to the admin stays the original error,
 * and a leftover account without a profile has a password nobody knows.
 */
async function removeAuthUser(
  admin: {
    auth: {
      admin: { deleteUser(id: string): Promise<{ error: unknown }> };
    };
  },
  userId: string
) {
  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('Admin create user: orphan auth account', userId, error);
    }
  } catch (err) {
    console.error('Admin create user: orphan auth account', userId, err);
  }
}

/** Limits of the free text fields of a new user (the form allows far less). */
const MAX_FULL_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;

export async function POST(req: NextRequest) {
  try {
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireAdmin(req);
    if (isErrorResponse(session)) return session;

    // Preview shares the auth of Production. An account created there carries
    // app_metadata.preview_only, which Production does not accept as a user
    // (src/lib/preview-account.ts).
    const body = await req.json();
    const { email, fullName, role, organizationId, sendEmail, catalogId } =
      body as {
        email: string;
        fullName: string;
        role: string;
        organizationId: string;
        sendEmail?: boolean;
        /** Occupation of a trainee (training catalog id), optional. */
        catalogId?: unknown;
      };

    // Every field is checked for its type before anything happens. A value such
    // as fullName: 123 would pass a plain truthiness check, create the auth
    // account and then fail on fullName.trim(), which leaves an account without
    // a profile and blocks the address.
    if (
      typeof email !== 'string' ||
      typeof fullName !== 'string' ||
      typeof role !== 'string' ||
      typeof organizationId !== 'string' ||
      !email.trim() ||
      !fullName.trim() ||
      !role ||
      !organizationId
    ) {
      return NextResponse.json(
        { error: 'email, fullName, role, and organizationId are required' },
        { status: 400 }
      );
    }
    if (
      fullName.trim().length > MAX_FULL_NAME_LENGTH ||
      email.trim().length > MAX_EMAIL_LENGTH
    ) {
      return NextResponse.json(
        { error: 'fullName or email is too long' },
        { status: 400 }
      );
    }

    // Org admins can only create users in their own organization
    if (!session.isSuperAdmin && organizationId !== session.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // The caller may only hand out roles assignableRoles allows
    const roleDecision = checkRoleForCreate(session, role);
    if (!roleDecision.ok) {
      return NextResponse.json(
        roleDecision.code
          ? { error: roleDecision.error, code: roleDecision.code }
          : { error: roleDecision.error },
        { status: roleDecision.status }
      );
    }
    const upperRole: string = roleDecision.role;

    // The occupation is optional and only a trainee has one. Without it the
    // trainee gets the default occupation of the organization.
    let requestedCatalogId: string | null = null;
    if (catalogId !== undefined && catalogId !== null) {
      if (upperRole !== ROLE.TRAINEE) {
        return NextResponse.json(
          ruleFailureBody({ ok: false, status: 400, code: 'NOT_A_TRAINEE' }),
          { status: 400 }
        );
      }
      if (!isUuid(catalogId)) {
        return NextResponse.json(
          { error: 'catalogId must be a uuid' },
          { status: 400 }
        );
      }
      requestedCatalogId = catalogId;
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

    // Early check, so a full organization or a wrong occupation is answered
    // before an auth account exists. The check that counts runs again inside
    // the transaction below.
    const early = await checkNewUser(db, {
      organizationId,
      role: roleDecision.role,
      requestedCatalogId,
    });
    if (!early.ok) {
      const failure = userWriteFailureBody(early);
      return NextResponse.json(failure.body, { status: failure.status });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_URL_INTERNAL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = getSupabaseSecretKey();
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const password = generatePassword();

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
      db: DB_OPTION,
    });

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: upperRole },
      ...previewAccountAppMetadata(),
    });

    if (createError) {
      return NextResponse.json(
        { error: createUserFailureMessage(createError) },
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

    // Seat check, profile and enrollment of a trainee are one transaction. If
    // it fails, the auth account created above is removed again, so no half
    // user stays behind (account without profile, profile without enrollment).
    let records;
    try {
      records = await createUserRecords({
        id: user.id,
        email: email.trim().toLowerCase(),
        fullName: fullName.trim(),
        firstName,
        lastName,
        role: roleDecision.role,
        organizationId,
        requestedCatalogId,
      });
    } catch (err) {
      console.error('Admin create user: writing the records failed', err);
      await removeAuthUser(admin, user.id);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
    if (!records.ok) {
      await removeAuthUser(admin, user.id);
      const failure = userWriteFailureBody(records);
      return NextResponse.json(failure.body, { status: failure.status });
    }

    // A new trainee gets the courses and global quizzes of the phase plan of
    // the occupation (only where courses are linked to components, so FIAE
    // stays as it is). A failure is logged, the tool of the platform admin
    // can catch up later.
    if (records.catalog) {
      await syncTraineeContentAfterEnrollment({
        catalogId: records.catalog.id,
        traineeId: user.id,
        actorId: session.id,
      });
    }

    // Send credentials email. Preview sends it only when asked for (sendEmail
    // true), the credentials are in the answer either way.
    let emailSent = false;
    if (shouldSendCredentialsEmail(sendEmail)) {
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
          and(
            eq(profiles.organizationId, organizationId),
            inArray(profiles.role, [...TRAINER_LEVEL_ROLES]),
            eq(profiles.isActive, true)
          )
        );

      for (const trainer of orgTrainers) {
        await db.insert(notifications).values({
          userId: trainer.id,
          actorId: user.id,
          type: 'TRAINEE_REGISTERED',
          title: 'Neuer Azubi hinzugefügt',
          message: `${fullName} (${email.trim()}) wurde als Azubi hinzugefügt.`,
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
        ...(records.catalog
          ? { trainingCatalogCode: records.catalog.code }
          : {}),
      },
      credentials: { email: email.trim(), password },
      emailSent,
    }, { status: 201 });
  } catch (e) {
    console.error('Admin create user error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
