/**
 * Which roles a caller may hand out when creating or editing a user.
 *
 * Pure functions between the request and the write of POST and PATCH
 * /api/admin/users. A value that is no role stays 400, a role the caller may
 * not hand out is 403 with the stable code ROLE_NOT_ASSIGNABLE. The rules
 * build on assignableRoles (src/lib/auth/roles.ts):
 *  - TEMP_ADMIN hands out TRAINER and TRAINEE only, never TEMP_ADMIN or ADMIN.
 *  - ADMIN hands out TEMP_ADMIN, TRAINER and TRAINEE, and (as before) promotes
 *    a user to ADMIN when editing. ADMIN is not created through POST.
 *  - Nobody hands out SUPER_ADMIN through the API.
 *  - An unchanged role (a client that sends the whole record) is no change and
 *    always passes.
 * The organization stays inside the scope of the caller, the routes check that.
 */

import {
  ROLE,
  assignableRoles,
  canManageAdmins,
  normalizeRole,
  type Role,
  type RoleSubject,
} from '@/lib/auth/roles';

/** Stable error code of a role the caller may not hand out. */
export const ROLE_NOT_ASSIGNABLE = 'ROLE_NOT_ASSIGNABLE' as const;

/** The roles POST /api/admin/users creates (ADMIN is promoted, not created). */
const CREATABLE_ROLES: readonly Role[] = [
  ROLE.TEMP_ADMIN,
  ROLE.TRAINER,
  ROLE.TRAINEE,
];

export type RoleDecision =
  | { ok: true; role: Role }
  | {
      ok: false;
      status: 400 | 403;
      code?: typeof ROLE_NOT_ASSIGNABLE;
      error: string;
    };

function notAssignable(role: Role, allowed: readonly Role[]): RoleDecision {
  return {
    ok: false,
    status: 403,
    code: ROLE_NOT_ASSIGNABLE,
    error:
      allowed.length > 0
        ? `You are not allowed to assign the role ${role}. You may assign: ${allowed.join(', ')}.`
        : `You are not allowed to assign the role ${role}.`,
  };
}

/** May the caller create a user with this role (POST)? */
export function checkRoleForCreate(
  subject: RoleSubject | null | undefined,
  requested: unknown
): RoleDecision {
  const invalid: RoleDecision = {
    ok: false,
    status: 400,
    error: 'Invalid role. Use TEMP_ADMIN, TRAINER, or TRAINEE.',
  };
  const role = typeof requested === 'string' ? normalizeRole(requested) : null;
  if (!role) return invalid;

  const allowed = assignableRoles(subject).filter(r =>
    CREATABLE_ROLES.includes(r)
  );
  if (!assignableRoles(subject).includes(role)) {
    return notAssignable(role, allowed);
  }
  if (!CREATABLE_ROLES.includes(role)) return invalid;
  return { ok: true, role };
}

/** May the caller set this role on an existing user (PATCH)? */
export function checkRoleForUpdate(
  subject: RoleSubject | null | undefined,
  requested: unknown,
  currentRole: string | null | undefined
): RoleDecision {
  const role = typeof requested === 'string' ? normalizeRole(requested) : null;
  if (!role) return { ok: false, status: 400, error: 'Invalid role' };
  // Nothing changes, so nothing is handed out
  if (role === normalizeRole(currentRole)) return { ok: true, role };

  const allowed: Role[] = [...assignableRoles(subject)];
  if (canManageAdmins(subject) && !allowed.includes(ROLE.ADMIN)) {
    allowed.unshift(ROLE.ADMIN);
  }
  if (!allowed.includes(role)) return notAssignable(role, allowed);
  return { ok: true, role };
}
