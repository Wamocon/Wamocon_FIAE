import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, ilike, or } from 'drizzle-orm';
import { profiles, userRole } from '@/db/migrations/schemas/schema';

// GET /api/trainer/profiles?role=TRAINER|TRAINEE&q=text
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');
    const q = searchParams.get('q')?.trim();
    const where: any[] = [];
    if (role === 'TRAINER' || role === 'TRAINEE') where.push(eq(profiles.role, role as any));
    if (q) where.push(or(ilike(profiles.fullName, `%${q}%`), ilike(profiles.email, `%${q}%`)) as any);

    const rows = await db
      .select({ id: profiles.id, fullName: profiles.fullName, email: profiles.email, role: profiles.role })
      .from(profiles)
      .where(where.length ? (where.length === 1 ? where[0] : and(...where as any)) : undefined as any)
      .limit(25);
    return NextResponse.json({ profiles: rows });
  } catch (e) {
    console.error('Search profiles error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
