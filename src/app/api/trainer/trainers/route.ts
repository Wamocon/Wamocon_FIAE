import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { TRAINER_LEVEL_ROLES } from '@/lib/auth/roles';
import { eq, ilike, and, ne, inArray } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';
import { getUserOrgId, verifyPlatformOwner } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim();
    const excludeId = searchParams.get('excludeId');
    const requesterId = session.id;


    const conditions: any[] = [
      inArray(profiles.role, [...TRAINER_LEVEL_ROLES]),
    ];

    const isPO = await verifyPlatformOwner(requesterId);
    if (!isPO) {
      const orgId = await getUserOrgId(requesterId);
      if (orgId) conditions.push(eq(profiles.organizationId, orgId));
    }

    if (q) conditions.push(ilike(profiles.fullName, `%${q}%`));
    if (excludeId) conditions.push(ne(profiles.id, excludeId));

    const rows = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(and(...conditions))
      .orderBy(profiles.fullName);

    return NextResponse.json({
      trainers: rows.map(r => ({ id: r.id, full_name: r.fullName })),
    });
  } catch (e) {
    console.error('List trainers error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
