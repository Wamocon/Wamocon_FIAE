/**
 * Central role definitions and permission helpers.
 *
 * Role hierarchy (highest first):
 *   SUPER_ADMIN > ADMIN > TEMP_ADMIN > TRAINER > TRAINEE
 *
 * - SUPER_ADMIN sees and manages everything platform-wide.
 * - ADMIN and TEMP_ADMIN only see and manage their own organization.
 *   TEMP_ADMIN can never create or change an ADMIN.
 * - TRAINER works with the trainees of their own organization.
 *
 * SUPER_ADMIN is not yet a value of the database enum. Until it is, an ADMIN
 * who belongs to the platform-owner organization (organizations.is_platform_owner)
 * counts as SUPER_ADMIN. That rule lives in isSuperAdmin() and nowhere else.
 */

export const ROLE = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  TEMP_ADMIN: 'TEMP_ADMIN',
  TRAINER: 'TRAINER',
  TRAINEE: 'TRAINEE',
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

/** Roles that may use admin-level APIs. */
export const ADMIN_ROLES: readonly Role[] = [
  ROLE.SUPER_ADMIN,
  ROLE.ADMIN,
  ROLE.TEMP_ADMIN,
];

/** Roles that may use trainer-level APIs (admins act as trainers too). */
export const TRAINER_LEVEL_ROLES: readonly Role[] = [
  ...ADMIN_ROLES,
  ROLE.TRAINER,
];

/** The minimal profile shape the helpers need. */
export type RoleSubject = {
  role?: string | null;
  isPlatformOwner?: boolean | null;
};

/** Upper-case and validate a stored role, unknown values give null. */
export function normalizeRole(role?: string | null): Role | null {
  const upper = String(role ?? '')
    .trim()
    .toUpperCase();
  return (Object.values(ROLE) as string[]).includes(upper)
    ? (upper as Role)
    : null;
}

/**
 * Platform-wide administrator. An ADMIN of the platform-owner organization
 * stands in for SUPER_ADMIN until the enum value exists in the database.
 */
export function isSuperAdmin(subject: RoleSubject | null | undefined): boolean {
  if (!subject) return false;
  const role = normalizeRole(subject.role);
  if (role === ROLE.SUPER_ADMIN) return true;
  return role === ROLE.ADMIN && subject.isPlatformOwner === true;
}

/** ADMIN or TEMP_ADMIN of one organization (not the platform-wide admin). */
export function isOrgAdmin(subject: RoleSubject | null | undefined): boolean {
  if (!subject) return false;
  const role = normalizeRole(subject.role);
  return role === ROLE.ADMIN || role === ROLE.TEMP_ADMIN;
}

/** Any admin level: SUPER_ADMIN, ADMIN or TEMP_ADMIN. */
export function isAdmin(subject: RoleSubject | null | undefined): boolean {
  return isSuperAdmin(subject) || isOrgAdmin(subject);
}

/** Trainer or any admin level. */
export function isTrainerLevel(
  subject: RoleSubject | null | undefined
): boolean {
  if (!subject) return false;
  return isAdmin(subject) || normalizeRole(subject.role) === ROLE.TRAINER;
}

/** May create, promote or change ADMIN users. Never true for TEMP_ADMIN. */
export function canManageAdmins(
  subject: RoleSubject | null | undefined
): boolean {
  if (!subject) return false;
  return isSuperAdmin(subject) || normalizeRole(subject.role) === ROLE.ADMIN;
}

/** Roles the subject may hand out when creating or editing users. */
export function assignableRoles(
  subject: RoleSubject | null | undefined
): Role[] {
  if (isSuperAdmin(subject)) {
    return [ROLE.ADMIN, ROLE.TEMP_ADMIN, ROLE.TRAINER, ROLE.TRAINEE];
  }
  if (canManageAdmins(subject)) {
    return [ROLE.TEMP_ADMIN, ROLE.TRAINER, ROLE.TRAINEE];
  }
  if (normalizeRole(subject?.role) === ROLE.TEMP_ADMIN) {
    return [ROLE.TRAINER, ROLE.TRAINEE];
  }
  return [];
}

/**
 * Whether the subject may change a user that currently has `targetRole`
 * (edit, deactivate, delete). TEMP_ADMIN cannot touch admins.
 */
export function canModifyRole(
  subject: RoleSubject | null | undefined,
  targetRole: string | null | undefined
): boolean {
  if (!isAdmin(subject)) return false;
  const target = normalizeRole(targetRole);
  if (target === ROLE.SUPER_ADMIN) return isSuperAdmin(subject);
  if (target === ROLE.ADMIN) return canManageAdmins(subject);
  return true;
}

/** Whether a role string counts as trainer-level (no profile needed). */
export function isTrainerLevelRole(role?: string | null): boolean {
  const normalized = normalizeRole(role);
  return !!normalized && TRAINER_LEVEL_ROLES.includes(normalized);
}

/** Whether a role string counts as admin-level (no profile needed). */
export function isAdminRole(role?: string | null): boolean {
  const normalized = normalizeRole(role);
  return !!normalized && ADMIN_ROLES.includes(normalized);
}
