/**
 * The admin entries of the sidebar, per admin level. Pure, no server imports,
 * so the sidebar and the tests share it.
 *
 *  - SUPER_ADMIN (and an ADMIN of the platform organization, see isSuperAdmin):
 *    the platform, that is all organizations with their occupations, and the
 *    users of every organization.
 *  - ADMIN: the own organization (seats, contact data) and the users of it.
 *  - TEMP_ADMIN: the same entries as the ADMIN, with fewer rights. An admin of
 *    the own organization (only that one): the route lets a TEMP_ADMIN change
 *    the master data (name, contact data, notes, logo) of it, plan, seats and
 *    activation stay with the platform admin for both, and the seats are shown
 *    to read.
 *  - Everyone else: no admin entry.
 *
 * The menu is never the protection. The routes check the role themselves (the
 * session layer, src/lib/auth/session.ts), a level that does not see an entry
 * is still turned away there.
 */

import {
  ROLE,
  isAdmin,
  isSuperAdmin,
  normalizeRole,
  type RoleSubject,
} from '@/lib/auth/roles';

export type AdminMenuItem = {
  id: 'adminOrgs' | 'adminUsers' | 'contentUpload' | 'contentStats';
  href: string;
  /** Key of the label in the locale files. */
  labelKey: string;
};

const ORGANIZATIONS_HREF = '/trainer/admin/organizations';
const USERS_HREF = '/trainer/admin/users';

const USERS_ITEM: AdminMenuItem = {
  id: 'adminUsers',
  href: USERS_HREF,
  labelKey: 'nav.userManagement',
};

const CONTENT_UPLOAD_HREF = '/trainer/admin/content-upload';

/**
 * The entry of the content upload (docs/ki-upload-konzept.md 7.5): only for the
 * people who may write curriculum content, and only where the feature runs. It is
 * switched off in Production (the routes answer 404 there), so the entry is not
 * shown there either: a preview build (the preview schema) and a build that is not a
 * production build show it. Like the rest of the menu this is not the protection.
 */
export function contentUploadMenuItems(
  subject: RoleSubject | null | undefined,
  env: { previewSchema: boolean; nodeEnv?: string | null }
): AdminMenuItem[] {
  if (!isSuperAdmin(subject)) return [];
  const runs = env.previewSchema || (env.nodeEnv ?? '') !== 'production';
  if (!runs) return [];
  return [
    {
      id: 'contentUpload',
      href: CONTENT_UPLOAD_HREF,
      labelKey: 'contentUpload.title',
    },
  ];
}

const CONTENT_STATS_HREF = '/trainer/admin/content-stats';

/**
 * The entry of the content statistics: every admin level (SUPER_ADMIN, ADMIN,
 * TEMP_ADMIN). The route sends the platform admin every catalog with targets
 * and an organization admin only the actual numbers of the catalogs of the own
 * organization. Like the rest of the menu this is not the protection.
 */
export function contentStatsMenuItems(
  subject: RoleSubject | null | undefined
): AdminMenuItem[] {
  if (!isAdmin(subject)) return [];
  return [
    {
      id: 'contentStats',
      href: CONTENT_STATS_HREF,
      labelKey: 'contentStats.menu',
    },
  ];
}

/** The admin entries a user sees, in the order of the sidebar. */
export function adminMenuItems(
  subject: RoleSubject | null | undefined
): AdminMenuItem[] {
  if (isSuperAdmin(subject)) {
    return [
      {
        id: 'adminOrgs',
        href: ORGANIZATIONS_HREF,
        labelKey: 'admin.menu.platform',
      },
      USERS_ITEM,
    ];
  }
  const role = normalizeRole(subject?.role);
  if (role === ROLE.ADMIN || role === ROLE.TEMP_ADMIN) {
    return [
      {
        id: 'adminOrgs',
        href: ORGANIZATIONS_HREF,
        labelKey: 'admin.menu.ownOrganization',
      },
      USERS_ITEM,
    ];
  }
  return [];
}
