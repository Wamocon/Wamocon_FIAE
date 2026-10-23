import { requireSuperAdmin, isErrorResponse } from '@/lib/auth/session';
import { listCatalogsWithUsage } from '@/lib/catalog/admin';
import { NextRequest, NextResponse } from 'next/server';

/**
 * All training catalogs with the number of trainees and organizations that use
 * them. Platform admin only.
 */
export async function GET(req: NextRequest) {
  try {
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireSuperAdmin(req);
    if (isErrorResponse(session)) return session;

    const catalogs = await listCatalogsWithUsage();
    return NextResponse.json({ catalogs });
  } catch (e) {
    console.error('Admin list catalogs error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
