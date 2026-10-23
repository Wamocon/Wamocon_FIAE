import {
  requireAdmin,
  requireSuperAdmin,
  isErrorResponse,
  scopeOrg,
  isInOrgScope,
} from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, count } from 'drizzle-orm';
import { organizations, profiles } from '@/db/migrations/schemas/schema';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireAdmin(req);
    if (isErrorResponse(session)) return session;

    // Org admins can only open their own organization
    if (!isInOrgScope(scopeOrg(session), orgId)) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId as any))
      .limit(1);

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({ organization: org });
  } catch (e) {
    console.error('Admin get org error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireAdmin(req);
    if (isErrorResponse(session)) return session;

    if (!isInOrgScope(scopeOrg(session), orgId)) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    // Plan, seats and activation are commercial settings of the platform
    if (
      !session.isSuperAdmin &&
      ['subscriptionPlan', 'maxTraineeSeats', 'maxTrainerSeats', 'isActive'].some(
        key => body[key] !== undefined
      )
    ) {
      return NextResponse.json(
        { error: 'Only the platform admin can change plan, seats or activation' },
        { status: 403 }
      );
    }

    if (typeof body.name === 'string') updates.name = body.name.trim();
    if (typeof body.subscriptionPlan === 'string') {
      if (!['LIGHT', 'PRO'].includes(body.subscriptionPlan)) {
        return NextResponse.json({ error: 'subscriptionPlan must be LIGHT or PRO' }, { status: 400 });
      }
      updates.subscriptionPlan = body.subscriptionPlan;
    }
    if (typeof body.maxTraineeSeats === 'number') updates.maxTraineeSeats = body.maxTraineeSeats;
    if (typeof body.maxTrainerSeats === 'number') updates.maxTrainerSeats = body.maxTrainerSeats;
    if (typeof body.isActive === 'boolean') {
      if (body.isActive === false) {
        const [target] = await db
          .select({ isPlatformOwner: organizations.isPlatformOwner })
          .from(organizations)
          .where(eq(organizations.id, orgId as any))
          .limit(1);
        if (target?.isPlatformOwner) {
          return NextResponse.json(
            { error: 'Cannot deactivate the platform owner organization' },
            { status: 403 }
          );
        }
      }
      updates.isActive = body.isActive;
    }
    if (typeof body.contactEmail === 'string') updates.contactEmail = body.contactEmail.trim();
    if (typeof body.contactPerson === 'string') updates.contactPerson = body.contactPerson.trim();
    if (typeof body.notes === 'string') updates.notes = body.notes.trim();
    if (typeof body.logoUrl === 'string') updates.logoUrl = body.logoUrl.trim();

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const [org] = await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, orgId as any))
      .returning();

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({ organization: org });
  } catch (e) {
    console.error('Admin update org error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    // Deleting an organization is a platform-wide action
    const session = await requireSuperAdmin(req);
    if (isErrorResponse(session)) return session;

    const [target] = await db
      .select({
        id: organizations.id,
        isPlatformOwner: organizations.isPlatformOwner,
        name: organizations.name,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId as any))
      .limit(1);

    if (!target) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (target.isPlatformOwner) {
      return NextResponse.json(
        { error: 'Cannot delete the platform owner organization' },
        { status: 403 }
      );
    }

    const [{ userCount }] = await db
      .select({ userCount: count() })
      .from(profiles)
      .where(eq(profiles.organizationId, orgId as any));

    if (userCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete organization with assigned users', userCount },
        { status: 400 }
      );
    }

    await db.delete(organizations).where(eq(organizations.id, orgId as any));

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Admin delete org error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
