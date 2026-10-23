import { NextResponse } from 'next/server';
import {
  IS_PREVIEW_SCHEMA,
  PREVIEW_ADMIN_BLOCKED_MESSAGE,
} from '@/lib/db-schema';

export { PREVIEW_ADMIN_BLOCKED_MESSAGE };

/**
 * Preview deployments share the Supabase Auth of Production (same users, same
 * service key). A Preview route that calls auth.admin.* (create, delete or
 * change a user) would therefore change real Production accounts. Such routes
 * are switched off in Preview with a clear 403; the data of Preview stays in
 * public_preview, accounts are not touched.
 *
 * Remaining risk and the robust way: docs/release-prozess.md, section
 * "Einschränkungen". A separate Supabase project for Preview is the robust
 * solution, this guard is the minimum.
 *
 * Returns a 403 response when running in Preview, otherwise null. Call it at
 * the start of every handler that uses auth.admin.*, after the authentication
 * check, and return the response if there is one.
 */
export function blockInPreview(
  isPreview: boolean = IS_PREVIEW_SCHEMA
): NextResponse | null {
  if (!isPreview) return null;
  return NextResponse.json(
    { error: PREVIEW_ADMIN_BLOCKED_MESSAGE, code: 'PREVIEW_ADMIN_DISABLED' },
    { status: 403 }
  );
}
