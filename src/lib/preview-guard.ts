import { NextResponse } from 'next/server';
import {
  IS_PREVIEW_SCHEMA,
  PREVIEW_ADMIN_BLOCKED_MESSAGE,
} from '@/lib/db-schema';
import {
  PREVIEW_ACCOUNT_REJECTED_CODE,
  PREVIEW_ACCOUNT_REJECTED_MESSAGE,
  isRejectedInProduction,
  type AuthUserLike,
} from '@/lib/preview-account';

export { PREVIEW_ADMIN_BLOCKED_MESSAGE };

/**
 * Preview deployments share the Supabase Auth of Production (same users, same
 * service key). A Preview route that calls auth.admin.* (create, delete or
 * change a user) could therefore change real Production accounts.
 *
 * Two kinds of routes with auth.admin.* exist:
 *
 *  - POST /api/admin/users and DELETE /api/admin/users/[userId] are open in
 *    Preview, because they handle the flag themselves (src/lib/preview-account.ts):
 *    an account created in Preview carries app_metadata.preview_only, Production
 *    rejects flagged accounts, and a delete in Preview removes an auth account
 *    only when it carries the flag. They never call blockInPreview().
 *  - Every other route that uses auth.admin.* is switched off in Preview with a
 *    clear 403 by blockInPreview(). A new route with auth.admin.* needs this
 *    call or its own check of the flag, and a review. The routes that create
 *    an account or send an e-mail with the public key (POST /api/register,
 *    POST /api/auth/resend-confirmation) use no auth.admin.*, but they act on
 *    the shared Auth of Production too and call blockInPreview() as well.
 *
 * Remaining risk and the robust way: docs/release-prozess.md, section
 * "Einschränkungen". A separate Supabase project for Preview is the robust
 * solution, this guard and the flag are the minimum.
 *
 * blockInPreview returns a 403 response when running in Preview, otherwise
 * null. Call it at the start of every handler that uses auth.admin.* and has no
 * handling of the flag, after the authentication check, and return the
 * response if there is one.
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

/**
 * Production side of the flag: an account created in Preview is no real user
 * there. Returns a 403 response (German message, code
 * PREVIEW_ACCOUNT_REJECTED) when a flagged auth user meets a deployment that is
 * not a Preview, otherwise null. Normal accounts always give null.
 */
export function blockPreviewAccountInProduction(
  user: AuthUserLike,
  isPreview: boolean = IS_PREVIEW_SCHEMA
): NextResponse | null {
  if (!isRejectedInProduction(user, isPreview)) return null;
  return NextResponse.json(
    {
      error: PREVIEW_ACCOUNT_REJECTED_MESSAGE,
      code: PREVIEW_ACCOUNT_REJECTED_CODE,
    },
    { status: 403 }
  );
}
