import { requireAdmin, isErrorResponse } from '@/lib/auth/session';
import { getContentStats } from '@/lib/catalog/content-stats';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Content statistics per training catalog: actual numbers (components,
 * enablers, scenarios, use cases, enabler quizzes, global quizzes, learning
 * fields), targets, difference and status.
 *
 * The platform admin reads every catalog with targets. ADMIN and TEMP_ADMIN of
 * an organization read only the catalogs that are enabled and active for the
 * own organization, and only the actual numbers (no targets). Trainers and
 * trainees are answered with 403. The caller's identity and organization come
 * from the session, never from the URL.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (isErrorResponse(session)) return session;

    const stats = await getContentStats({
      isSuperAdmin: session.isSuperAdmin,
      organizationId: session.organizationId,
    });
    return NextResponse.json(stats);
  } catch (e) {
    console.error('Admin content stats error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
