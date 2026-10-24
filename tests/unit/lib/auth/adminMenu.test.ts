import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { adminMenuItems, type AdminMenuItem } from '@/lib/auth/adminMenu';
import { GUARDED_ROUTES } from '../../../helpers/guardedRoutes';

// The admin part of the sidebar differs per level:
//  - SUPER_ADMIN (and an ADMIN of the platform organization): the platform,
//    that is organizations with their occupations, and the users
//  - ADMIN: the own organization (seats, contact data) and the users
//  - TEMP_ADMIN: only the users (trainers and trainees)
//  - trainers and trainees: nothing
// The menu is never the protection. Every entry opens a page whose API routes
// check the role themselves (route-guards.test.ts runs every guarded route
// with a role that is too low), and this file proves that no entry is shown
// to a level that the route behind it would turn away.

const platformAdmin = { role: 'ADMIN', isPlatformOwner: true };
const superAdmin = { role: 'SUPER_ADMIN', isPlatformOwner: true };
const admin = { role: 'ADMIN', isPlatformOwner: false };
const tempAdmin = { role: 'TEMP_ADMIN', isPlatformOwner: false };
const platformTempAdmin = { role: 'TEMP_ADMIN', isPlatformOwner: true };

const ids = (items: AdminMenuItem[]) => items.map(i => i.id);

describe('adminMenuItems', () => {
  it.each([
    ['SUPER_ADMIN', superAdmin],
    ['ADMIN of the platform organization', platformAdmin],
  ])('%s sees the platform and the users', (_name, subject) => {
    expect(adminMenuItems(subject)).toEqual([
      {
        id: 'adminOrgs',
        href: '/trainer/admin/organizations',
        labelKey: 'admin.menu.platform',
      },
      {
        id: 'adminUsers',
        href: '/trainer/admin/users',
        labelKey: 'nav.userManagement',
      },
    ]);
  });

  it('ADMIN of a customer organization sees the own organization and the users', () => {
    expect(adminMenuItems(admin)).toEqual([
      {
        id: 'adminOrgs',
        href: '/trainer/admin/organizations',
        labelKey: 'admin.menu.ownOrganization',
      },
      {
        id: 'adminUsers',
        href: '/trainer/admin/users',
        labelKey: 'nav.userManagement',
      },
    ]);
  });

  it('TEMP_ADMIN sees the users only, also in the platform organization', () => {
    expect(ids(adminMenuItems(tempAdmin))).toEqual(['adminUsers']);
    expect(ids(adminMenuItems(platformTempAdmin))).toEqual(['adminUsers']);
  });

  it('roles below the admin levels and unknown values see nothing', () => {
    for (const subject of [
      { role: 'TRAINER', isPlatformOwner: true },
      { role: 'TRAINEE', isPlatformOwner: true },
      { role: 'ROOT' },
      { role: null },
      null,
      undefined,
    ]) {
      expect(adminMenuItems(subject)).toEqual([]);
    }
  });

  it('reads the role in any letter case, as the profile stores it', () => {
    expect(ids(adminMenuItems({ role: 'temp_admin' }))).toEqual(['adminUsers']);
    expect(ids(adminMenuItems({ role: 'admin' }))).toEqual([
      'adminOrgs',
      'adminUsers',
    ]);
  });

  it('every entry opens a page that exists', () => {
    for (const subject of [superAdmin, admin, tempAdmin]) {
      for (const item of adminMenuItems(subject)) {
        const page = path.join(process.cwd(), 'src/app', item.href, 'page.tsx');
        expect(fs.existsSync(page)).toBe(true);
      }
    }
  });
});

// The API routes each page calls. The first one is what the page cannot work
// without when it opens.
const PAGE_ROUTES: Record<
  AdminMenuItem['id'],
  { route: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT' }[]
> = {
  adminOrgs: [
    { route: 'admin/organizations', method: 'GET' },
    { route: 'admin/organizations/[orgId]', method: 'PATCH' },
    { route: 'admin/organizations', method: 'POST' },
    { route: 'admin/organizations/[orgId]', method: 'DELETE' },
    { route: 'admin/organizations/[orgId]/catalogs', method: 'GET' },
    { route: 'admin/organizations/[orgId]/catalogs', method: 'PUT' },
    { route: 'admin/catalogs', method: 'GET' },
  ],
  adminUsers: [
    { route: 'admin/users', method: 'GET' },
    { route: 'admin/organizations', method: 'GET' },
    { route: 'admin/users', method: 'POST' },
    { route: 'admin/users/[userId]', method: 'PATCH' },
    { route: 'admin/users/[userId]', method: 'DELETE' },
    { route: 'admin/organizations/[orgId]/catalogs', method: 'GET' },
  ],
};

const guardOf = (route: string, method: string) =>
  GUARDED_ROUTES.find(r => r.route === route && r.method === method)?.guard;

describe('the menu is not the protection', () => {
  it('every route behind a menu entry is guarded by the session layer', () => {
    for (const routes of Object.values(PAGE_ROUTES)) {
      for (const { route, method } of routes) {
        const guard = guardOf(route, method);
        // route-guards.test.ts runs every entry of this table with no token
        // (401) and with a role below the guard (403)
        expect(['admin', 'superAdmin']).toContain(guard);
      }
    }
  });

  it('the page load of an entry is open to every level that sees the entry', () => {
    for (const subject of [superAdmin, admin, tempAdmin]) {
      const isSuper = adminMenuItems(subject).some(
        i => i.labelKey === 'admin.menu.platform'
      );
      for (const item of adminMenuItems(subject)) {
        const [load] = PAGE_ROUTES[item.id];
        const guard = guardOf(load.route, load.method);
        // a super admin guard would turn ADMIN and TEMP_ADMIN away
        expect(guard === 'admin' || (guard === 'superAdmin' && isSuper)).toBe(
          true
        );
      }
    }
  });

  it('the write routes of the platform stay with the platform admin whatever the menu shows', () => {
    for (const { route, method } of [
      { route: 'admin/organizations', method: 'POST' },
      { route: 'admin/organizations/[orgId]', method: 'DELETE' },
      { route: 'admin/organizations/[orgId]/catalogs', method: 'PUT' },
      { route: 'admin/catalogs', method: 'GET' },
      { route: 'admin/catalogs/[catalogId]', method: 'PATCH' },
      { route: 'admin/users/[userId]/enrollment', method: 'PUT' },
    ]) {
      expect(guardOf(route, method)).toBe('superAdmin');
    }
  });
});
