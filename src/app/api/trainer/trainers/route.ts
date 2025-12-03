import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, ilike, and } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim();
    const excludeId = searchParams.get('excludeId');

    const where = q
      ? and(eq(profiles.role, 'TRAINER'), ilike(profiles.fullName, `%${q}%`))
      : eq(profiles.role, 'TRAINER');

    const rows = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(where)
      .orderBy(profiles.fullName);

    const filtered = excludeId ? rows.filter(r => String(r.id) !== String(excludeId)) : rows;
    return NextResponse.json({ trainers: filtered.map(r => ({ id: r.id, full_name: r.fullName })) });
  } catch (e) {
    console.error('List trainers error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
