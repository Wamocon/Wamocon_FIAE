import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, sql } from 'drizzle-orm';
import { organizations, profiles } from '@/db/migrations/schemas/schema';
import { verifyAdmin } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const adminId = searchParams.get('adminId');
    if (!adminId || !(await verifyAdmin(adminId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const orgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        logoUrl: organizations.logoUrl,
        subscriptionPlan: organizations.subscriptionPlan,
        maxTraineeSeats: organizations.maxTraineeSeats,
        maxTrainerSeats: organizations.maxTrainerSeats,
        isActive: organizations.isActive,
        isPlatformOwner: organizations.isPlatformOwner,
        contactEmail: organizations.contactEmail,
        contactPerson: organizations.contactPerson,
        notes: organizations.notes,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
      })
      .from(organizations)
      .orderBy(organizations.name);

    const orgIds = orgs.map(o => o.id);
    const counts: Record<string, { trainers: number; trainees: number }> = {};

    if (orgIds.length > 0) {
      const rows = await db
        .select({
          orgId: profiles.organizationId,
          role: profiles.role,
          count: sql<number>`count(*)::int`,
        })
        .from(profiles)
        .groupBy(profiles.organizationId, profiles.role);

      for (const r of rows) {
        const oid = r.orgId ?? '';
        if (!counts[oid]) counts[oid] = { trainers: 0, trainees: 0 };
        const upper = String(r.role).toUpperCase();
        if (['ADMIN', 'TEMP_ADMIN', 'TRAINER'].includes(upper)) {
          counts[oid].trainers += r.count;
        } else if (upper === 'TRAINEE') {
          counts[oid].trainees += r.count;
        }
      }
    }

    return NextResponse.json({
      organizations: orgs.map(o => ({
        ...o,
        currentTrainers: counts[o.id]?.trainers ?? 0,
        currentTrainees: counts[o.id]?.trainees ?? 0,
      })),
    });
  } catch (e) {
    console.error('Admin list orgs error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const adminId = searchParams.get('adminId');
    if (!adminId || !(await verifyAdmin(adminId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { name, slug, subscriptionPlan, maxTraineeSeats, maxTrainerSeats, contactEmail, contactPerson, notes, logoUrl } = body;

    if (!name || !slug || !subscriptionPlan) {
      return NextResponse.json(
        { error: 'name, slug, and subscriptionPlan are required' },
        { status: 400 }
      );
    }

    if (!['LIGHT', 'PRO'].includes(subscriptionPlan)) {
      return NextResponse.json({ error: 'subscriptionPlan must be LIGHT or PRO' }, { status: 400 });
    }

    const sanitizedSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const existing = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, sanitizedSlug))
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Slug already in use' }, { status: 409 });
    }

    const [org] = await db
      .insert(organizations)
      .values({
        name,
        slug: sanitizedSlug,
        logoUrl: logoUrl || null,
        subscriptionPlan: subscriptionPlan as 'LIGHT' | 'PRO',
        maxTraineeSeats: maxTraineeSeats ?? 50,
        maxTrainerSeats: maxTrainerSeats ?? 5,
        isActive: true,
        isPlatformOwner: false,
        contactEmail: contactEmail || null,
        contactPerson: contactPerson || null,
        notes: notes || null,
      })
      .returning();

    return NextResponse.json({ organization: org }, { status: 201 });
  } catch (e) {
    console.error('Admin create org error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
