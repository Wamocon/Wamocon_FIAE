/**
 * German message for a failed call of the user administration (POST and PATCH
 * /api/admin/users). The API answers { error, code, ... } with English text and
 * a stable code. Known codes get their own German text: SEATS_FULL names the
 * kind of seat and the numbers and says who can raise the seats,
 * ROLE_NOT_ASSIGNABLE says that the role cannot be handed out, and the
 * occupation codes use the texts of the catalog administration. Anything else
 * keeps the text of the server (as before), and the fallback key is used when
 * there is nothing to show.
 */

type Translate = (
  key: string,
  data?: Record<string, string | number>
) => string;

export async function adminUserErrorMessage(
  response: Response,
  t: Translate,
  fallbackKey: string,
  options: { isSuperAdmin: boolean }
): Promise<string> {
  let data: {
    code?: unknown;
    error?: unknown;
    kind?: unknown;
    occupied?: unknown;
    limit?: unknown;
  } | null = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  const code = typeof data?.code === 'string' ? data.code : null;
  if (
    code === 'SEATS_FULL' &&
    (data?.kind === 'trainee' || data?.kind === 'trainer')
  ) {
    return t(
      `admin.seats.error.SEATS_FULL.${data.kind}.${options.isSuperAdmin ? 'superAdmin' : 'admin'}`,
      { occupied: Number(data.occupied ?? 0), limit: Number(data.limit ?? 0) }
    );
  }
  if (code === 'ROLE_NOT_ASSIGNABLE') {
    return t('admin.seats.error.ROLE_NOT_ASSIGNABLE');
  }
  if (code === 'ORGANIZATION_REQUIRED') {
    return t('admin.userCreate.error.ORGANIZATION_REQUIRED');
  }
  if (code === 'CATALOG_REQUIRED') {
    return t('admin.userCreate.error.CATALOG_REQUIRED');
  }
  if (code) {
    const key = `admin.catalogs.error.${code}`;
    const text = t(key);
    // t() returns the key itself for a code without a translation
    if (text !== key) return text;
  }
  if (typeof data?.error === 'string' && data.error) return data.error;
  return t(fallbackKey);
}

/**
 * Translation key of the toast after a delete. Production answers
 * { success: true }. Preview also says whether the auth account stayed
 * (authAccountKept): a real account that Preview shares with Production keeps
 * its auth account, only the Preview profile goes.
 */
export function deleteSuccessMessageKey(
  data: { authAccountKept?: unknown; authAccountKeptReason?: unknown } | null
): string {
  if (data?.authAccountKept !== true) return 'admin.users.userDeleted';
  return data.authAccountKeptReason === 'SHARED_ACCOUNT'
    ? 'admin.users.userDeletedAccountShared'
    : 'admin.users.userDeletedAccountKept';
}
