/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  assignableRoles,
  canManageAdmins,
  canModifyRole,
  isAdminRole,
  isTrainerLevelRole,
  isAdmin,
  isTrainerLevel,
} from '@/lib/auth/roles';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, mockSession } from '../../../helpers/mockNext';

// SUPER_ADMIN must have at least the rights of ADMIN everywhere. The role is
// stored upper case in the database and lower case in the browser profile; the
// central helpers accept both.

describe('role helpers treat SUPER_ADMIN like ADMIN', () => {
  it.each(['SUPER_ADMIN', 'super_admin', 'ADMIN', 'admin', 'TEMP_ADMIN'])(
    '%s counts as admin and trainer level',
    role => {
      expect(isAdminRole(role)).toBe(true);
      expect(isTrainerLevelRole(role)).toBe(true);
      expect(isAdmin({ role })).toBe(true);
      expect(isTrainerLevel({ role })).toBe(true);
    }
  );

  it('a trainer is trainer level but not admin, a trainee neither', () => {
    expect(isTrainerLevelRole('trainer')).toBe(true);
    expect(isAdminRole('trainer')).toBe(false);
    expect(isTrainerLevelRole('trainee')).toBe(false);
  });

  it('SUPER_ADMIN may manage admins and change every role', () => {
    expect(canManageAdmins({ role: 'SUPER_ADMIN' })).toBe(true);
    expect(canManageAdmins({ role: 'TEMP_ADMIN' })).toBe(false);
    expect(canModifyRole({ role: 'SUPER_ADMIN' }, 'ADMIN')).toBe(true);
    expect(canModifyRole({ role: 'SUPER_ADMIN' }, 'SUPER_ADMIN')).toBe(true);
    // an ADMIN cannot touch a SUPER_ADMIN
    expect(canModifyRole({ role: 'ADMIN' }, 'SUPER_ADMIN')).toBe(false);
    expect(assignableRoles({ role: 'SUPER_ADMIN' })).toEqual(
      expect.arrayContaining(['ADMIN', 'TEMP_ADMIN', 'TRAINER', 'TRAINEE'])
    );
  });
});

describe('server routes include SUPER_ADMIN', () => {
  beforeEach(() => jest.clearAllMocks());

  it('the trainer list contains every trainer level role', async () => {
    jest.resetModules();
    const mock = createTableDb({ profiles: [] });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    jest.doMock('@/lib/auth-helpers', () => ({
      __esModule: true,
      verifyPlatformOwner: async () => true,
      getUserOrgId: async () => 'org-1',
    }));
    mockSession(fakeSession({ id: 'tr1' }));
    const mod = await import('@/app/api/trainer/trainers/route');
    const res = await mod.GET({
      url: 'http://localhost/api/trainer/trainers',
      headers: { get: () => null },
    } as any);
    expect(res.status).toBe(200);
    expect(mock.filters('select', 'profiles').params).toEqual(
      expect.arrayContaining(['SUPER_ADMIN', 'ADMIN', 'TEMP_ADMIN', 'TRAINER'])
    );
  });
});

describe('no hard coded admin role lists', () => {
  // Role lists must come from src/lib/auth/roles.ts, otherwise a new role
  // (SUPER_ADMIN) silently loses rights where a list was copied.
  const root = path.join(process.cwd(), 'src');
  const allowed = new Set(
    [
      'lib/auth/roles.ts',
      'db/migrations/schemas/schema.ts',
      // role ASSIGNMENT lists: SUPER_ADMIN is never handed out through the API
      'app/api/admin/users/route.ts',
      'app/api/admin/users/[userId]/route.ts',
    ].map(p => path.join(root, p))
  );
  const patterns = [
    /\[\s*'(?:TRAINER|ADMIN|TEMP_ADMIN)'\s*,\s*'(?:TRAINER|ADMIN|TEMP_ADMIN)'/,
    /\[\s*'(?:trainer|admin|temp_admin)'\s*,\s*'(?:trainer|admin|temp_admin)'/,
    /IN \('TRAINER', 'TEMP_ADMIN', 'ADMIN'\)/,
  ];

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it('finds no copied role lists outside the central helper', () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (allowed.has(file)) continue;
      const text = fs.readFileSync(file, 'utf-8');
      if (patterns.some(p => p.test(text))) {
        offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
