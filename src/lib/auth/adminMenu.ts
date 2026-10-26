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
  isSuperAdmin,
  normalizeRole,
  type RoleSubject,
} from '@/lib/auth/roles';

export type AdminMenuItem = {
  id: 'adminOrgs' | 'adminUsers';
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
