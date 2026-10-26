import { IS_PREVIEW_SCHEMA } from '@/lib/db-schema';

/**
 * Accounts created in Preview.
 *
 * Preview and Production share one Supabase Auth (same auth.users, same
 * service key). An account that the Preview creates is therefore visible to
 * Production. To keep it out of Production it carries a flag in app_metadata,
 * which only the service role can write (the user cannot change it, unlike
 * user_metadata):
 *
 *   - POST /api/admin/users sets it when the deployment is a Preview.
 *   - DELETE /api/admin/users/[userId] deletes an auth account in Preview only
 *     when it carries the flag. A real, shared account keeps its auth account.
 *   - Production rejects a flagged account at the sign-in (AuthContext), in
 *     /api/auth/sync-profile and in the session layer (src/lib/auth/session.ts).
 *
 * This module has no server dependencies, the browser uses it too.
 * Docs: docs/release-prozess.md, section "Einschränkungen".
 */

/** Key in app_metadata that marks an account of the Preview. */
export const PREVIEW_ONLY_KEY = 'preview_only';

export const PREVIEW_ACCOUNT_REJECTED_CODE = 'PREVIEW_ACCOUNT_REJECTED';

export const PREVIEW_ACCOUNT_REJECTED_MESSAGE =
  'Dieses Konto wurde in der Preview-Umgebung für Tests angelegt und gilt in Production nicht. Bitte wenden Sie sich an Ihren Administrator.';

/** The part of an auth user this module reads. */
export type AuthUserLike = { app_metadata?: unknown } | null | undefined;

/**
 * True when the auth user carries the Preview flag. Only the boolean true in
 * app_metadata counts. user_metadata is never read, the user can change it.
 */
export function isPreviewOnlyUser(user: AuthUserLike): boolean {
  const metadata = user?.app_metadata;
  if (typeof metadata !== 'object' || metadata === null) return false;
  return (metadata as Record<string, unknown>)[PREVIEW_ONLY_KEY] === true;
}

/**
 * Attributes for auth.admin.createUser: the flag in Preview, nothing at all
 * elsewhere (no new field in Production).
 */
export function previewAccountAppMetadata(
  isPreview: boolean = IS_PREVIEW_SCHEMA
): { app_metadata?: { preview_only: true } } {
  return isPreview ? { app_metadata: { [PREVIEW_ONLY_KEY]: true } } : {};
}

/**
 * Whether the credentials mail goes out. Production sends unless the
 * administrator switches it off (as before). Preview sends only when the
 * administrator asks with sendEmail: true, the credentials are in the answer.
 */
export function shouldSendCredentialsEmail(
  sendEmail: unknown,
  isPreview: boolean = IS_PREVIEW_SCHEMA
): boolean {
  return isPreview ? sendEmail === true : sendEmail !== false;
}

/** True when a flagged account meets a deployment that is not a Preview. */
export function isRejectedInProduction(
  user: AuthUserLike,
  isPreview: boolean = IS_PREVIEW_SCHEMA
): boolean {
  return !isPreview && isPreviewOnlyUser(user);
}

/** The part of the Supabase admin client that the delete uses. */
export type AuthAdminLike = {
  auth: {
    admin: {
      getUserById(id: string): Promise<{
        data: { user?: AuthUserLike } | null;
        error: unknown;
      }>;
      deleteUser(id: string): Promise<{ error: unknown }>;
    };
  };
};

/**
 * Why an auth account stays after a delete in Preview.
 * SHARED_ACCOUNT: a real account without the flag, kept on purpose.
 * CHECK_FAILED: the flag could not be read, kept (fail closed).
 * DELETE_FAILED: the flagged account could not be deleted.
 */
export type AuthKeptReason =
  | 'SHARED_ACCOUNT'
  | 'CHECK_FAILED'
  | 'DELETE_FAILED';

export type AuthDeleteResult =
  | { deleted: true }
  | { deleted: false; reason: AuthKeptReason };

/**
 * Delete an auth account from Preview, only if it carries the Preview flag.
 * The flag is read from the auth server with the service key, never from the
 * client. Whatever is not clearly a flagged account is kept: an account
 * without the flag, a failing or empty lookup, an error that comes with a user.
 * Never throws.
 */
export async function deleteAuthAccountIfPreviewOnly(
  admin: AuthAdminLike,
  userId: string
): Promise<AuthDeleteResult> {
  let user: AuthUserLike;
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) return { deleted: false, reason: 'CHECK_FAILED' };
    user = data.user;
  } catch (err) {
    console.error('Preview delete user: lookup failed', userId, err);
    return { deleted: false, reason: 'CHECK_FAILED' };
  }
  if (!isPreviewOnlyUser(user)) {
    return { deleted: false, reason: 'SHARED_ACCOUNT' };
  }
  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('Preview delete user: auth account kept', userId, error);
      return { deleted: false, reason: 'DELETE_FAILED' };
    }
  } catch (err) {
    console.error('Preview delete user: auth account kept', userId, err);
    return { deleted: false, reason: 'DELETE_FAILED' };
  }
  return { deleted: true };
}

export const PREVIEW_CREATE_FAILED_MESSAGE =
  'The account could not be created. The address may already be in use.';

/**
 * Error text for a failed auth.admin.createUser. The auth server tells "already
 * registered" for every address of the shared auth, which includes all
 * Production users. Preview therefore answers one generic text and only logs
 * the real one, so a Preview administrator cannot probe for Production
 * addresses. Production keeps the text of the auth server (as before).
 */
export function createUserFailureMessage(
  error: unknown,
  isPreview: boolean = IS_PREVIEW_SCHEMA
): string {
  if (isPreview) {
    console.error('Preview create user: auth server refused', error);
    return PREVIEW_CREATE_FAILED_MESSAGE;
  }
  return (
    (error as { message?: string } | null)?.message ||
    'Failed to create auth user'
  );
}
