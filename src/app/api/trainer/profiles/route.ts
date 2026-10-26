import {
  requireTrainer,
  isErrorResponse,
  scopeOrg,
  orgScopeCondition,
} from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, ilike, ne, or } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';
import { requireTraineeCatalogFilter } from '@/lib/catalog/trainee-scope';

// GET /api/trainer/profiles?role=TRAINER|TRAINEE&q=text
export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');
    const q = searchParams.get('q')?.trim();
    // Everyone but the super admin only finds profiles of their own organization
    const orgCondition = orgScopeCondition(
      profiles.organizationId,
      scopeOrg(session)
    );
    const where: any[] = orgCondition ? [orgCondition] : [];
    if (role === 'TRAINER' || role === 'TRAINEE') where.push(eq(profiles.role, role as any));
    // With a chosen occupation (x-catalog) the trainees of other occupations
    // are not found. People who are no trainees are not narrowed.
    if (role !== 'TRAINER') {
      const catalogFilter = await requireTraineeCatalogFilter(session, req);
      if (catalogFilter instanceof Response) return catalogFilter;
      if (catalogFilter.condition) {
        where.push(
          or(ne(profiles.role, 'TRAINEE' as any), catalogFilter.condition) as any
        );
      }
    }
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
