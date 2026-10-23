import { describe, it, expect } from '@jest/globals';
import {
  assignableRoles,
  canManageAdmins,
  canModifyRole,
  isAdmin,
  isAdminRole,
  isOrgAdmin,
  isSuperAdmin,
  isTrainerLevel,
  isTrainerLevelRole,
  normalizeRole,
  ROLE,
} from '@/lib/auth/roles';

const platformAdmin = { role: 'ADMIN', isPlatformOwner: true };
const orgAdmin = { role: 'ADMIN', isPlatformOwner: false };
const tempAdmin = { role: 'TEMP_ADMIN', isPlatformOwner: false };
const platformTempAdmin = { role: 'TEMP_ADMIN', isPlatformOwner: true };
const trainer = { role: 'TRAINER', isPlatformOwner: true };
const trainee = { role: 'TRAINEE', isPlatformOwner: false };

describe('auth/roles', () => {
  describe('normalizeRole', () => {
    it('upper-cases and validates known roles', () => {
      expect(normalizeRole('admin')).toBe('ADMIN');
      expect(normalizeRole(' Super_Admin ')).toBe('SUPER_ADMIN');
      expect(normalizeRole('TRAINEE')).toBe('TRAINEE');
    });

    it('returns null for unknown or empty values', () => {
      expect(normalizeRole('ROOT')).toBeNull();
      expect(normalizeRole('')).toBeNull();
      expect(normalizeRole(null)).toBeNull();
      expect(normalizeRole(undefined)).toBeNull();
    });
  });

  describe('isSuperAdmin', () => {
    it('accepts the SUPER_ADMIN role', () => {
      expect(isSuperAdmin({ role: ROLE.SUPER_ADMIN })).toBe(true);
    });

    it('treats an ADMIN of the platform-owner organization as SUPER_ADMIN', () => {
      expect(isSuperAdmin(platformAdmin)).toBe(true);
    });

    it('rejects ADMIN of a customer organization and every lower role', () => {
      expect(isSuperAdmin(orgAdmin)).toBe(false);
      expect(isSuperAdmin(platformTempAdmin)).toBe(false);
      expect(isSuperAdmin(trainer)).toBe(false);
      expect(isSuperAdmin(trainee)).toBe(false);
      expect(isSuperAdmin(null)).toBe(false);
      expect(isSuperAdmin(undefined)).toBe(false);
    });
  });

  describe('isOrgAdmin / isAdmin / isTrainerLevel', () => {
    it('isOrgAdmin covers ADMIN and TEMP_ADMIN only', () => {
      expect(isOrgAdmin(orgAdmin)).toBe(true);
      expect(isOrgAdmin(tempAdmin)).toBe(true);
      expect(isOrgAdmin({ role: 'SUPER_ADMIN' })).toBe(false);
      expect(isOrgAdmin(trainer)).toBe(false);
      expect(isOrgAdmin(null)).toBe(false);
    });

    it('isAdmin covers all three admin levels', () => {
      expect(isAdmin({ role: 'SUPER_ADMIN' })).toBe(true);
      expect(isAdmin(orgAdmin)).toBe(true);
      expect(isAdmin(tempAdmin)).toBe(true);
      expect(isAdmin(trainer)).toBe(false);
      expect(isAdmin(trainee)).toBe(false);
    });

    it('isTrainerLevel adds TRAINER but not TRAINEE', () => {
      expect(isTrainerLevel(trainer)).toBe(true);
      expect(isTrainerLevel(tempAdmin)).toBe(true);
      expect(isTrainerLevel(trainee)).toBe(false);
      expect(isTrainerLevel({ role: 'WHATEVER' })).toBe(false);
      expect(isTrainerLevel(null)).toBe(false);
    });
  });

  describe('canManageAdmins', () => {
    it('is true for SUPER_ADMIN and ADMIN, never for TEMP_ADMIN', () => {
      expect(canManageAdmins({ role: 'SUPER_ADMIN' })).toBe(true);
      expect(canManageAdmins(orgAdmin)).toBe(true);
      expect(canManageAdmins(platformTempAdmin)).toBe(false);
      expect(canManageAdmins(tempAdmin)).toBe(false);
      expect(canManageAdmins(trainer)).toBe(false);
      expect(canManageAdmins(null)).toBe(false);
    });
  });

  describe('assignableRoles', () => {
    it('lets the platform admin hand out every role below SUPER_ADMIN', () => {
      expect(assignableRoles(platformAdmin)).toEqual([
        'ADMIN',
        'TEMP_ADMIN',
        'TRAINER',
        'TRAINEE',
      ]);
    });

    it('keeps ADMIN from creating ADMINs, as today', () => {
      expect(assignableRoles(orgAdmin)).toEqual([
        'TEMP_ADMIN',
        'TRAINER',
        'TRAINEE',
      ]);
    });

    it('limits TEMP_ADMIN to trainers and trainees, and others to nothing', () => {
      expect(assignableRoles(tempAdmin)).toEqual(['TRAINER', 'TRAINEE']);
      expect(assignableRoles(trainer)).toEqual([]);
      expect(assignableRoles(null)).toEqual([]);
    });
  });

  describe('canModifyRole', () => {
    it('blocks TEMP_ADMIN from changing ADMIN users', () => {
      expect(canModifyRole(tempAdmin, 'ADMIN')).toBe(false);
      expect(canModifyRole(tempAdmin, 'TRAINER')).toBe(true);
      expect(canModifyRole(tempAdmin, 'TEMP_ADMIN')).toBe(true);
    });

    it('lets ADMIN change everything but a SUPER_ADMIN', () => {
      expect(canModifyRole(orgAdmin, 'ADMIN')).toBe(true);
      expect(canModifyRole(orgAdmin, 'SUPER_ADMIN')).toBe(false);
      expect(canModifyRole(platformAdmin, 'SUPER_ADMIN')).toBe(true);
    });

    it('denies non-admins outright', () => {
      expect(canModifyRole(trainer, 'TRAINEE')).toBe(false);
      expect(canModifyRole(null, 'TRAINEE')).toBe(false);
    });
  });

  describe('role string checks', () => {
    it('isTrainerLevelRole and isAdminRole work on bare strings', () => {
      expect(isTrainerLevelRole('trainer')).toBe(true);
      expect(isTrainerLevelRole('SUPER_ADMIN')).toBe(true);
      expect(isTrainerLevelRole('TRAINEE')).toBe(false);
      expect(isAdminRole('TEMP_ADMIN')).toBe(true);
      expect(isAdminRole('TRAINER')).toBe(false);
      expect(isAdminRole(undefined)).toBe(false);
    });
  });
});
