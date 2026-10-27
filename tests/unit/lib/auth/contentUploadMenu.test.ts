import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { adminMenuItems, contentUploadMenuItems } from '@/lib/auth/adminMenu';

// The entry of the content upload in the sidebar: only for the people who may
// write curriculum content (the routes check that again with
// requireCurriculumEditor) and only where the feature runs. In Production it is off
// and the routes answer 404, so the entry is not shown there either. The menu is
// never the protection.

const superAdmin = { role: 'SUPER_ADMIN', isPlatformOwner: true };
const platformAdmin = { role: 'ADMIN', isPlatformOwner: true };
const customerAdmin = { role: 'ADMIN', isPlatformOwner: false };
const tempAdmin = { role: 'TEMP_ADMIN', isPlatformOwner: true };
const trainer = { role: 'TRAINER', isPlatformOwner: true };
const trainee = { role: 'TRAINEE', isPlatformOwner: false };

const ENTRY = {
  id: 'contentUpload',
  href: '/trainer/admin/content-upload',
  labelKey: 'contentUpload.title',
};

describe('contentUploadMenuItems', () => {
  it.each([
    ['SUPER_ADMIN', superAdmin],
    ['ADMIN of the platform organization', platformAdmin],
  ])(
    'shows the entry to %s in a build that is not a production build',
    (_n, subject) => {
      expect(
        contentUploadMenuItems(subject, {
          previewSchema: false,
          nodeEnv: 'development',
        })
      ).toEqual([ENTRY]);
      expect(
        contentUploadMenuItems(subject, {
          previewSchema: false,
          nodeEnv: 'test',
        })
      ).toEqual([ENTRY]);
      expect(contentUploadMenuItems(subject, { previewSchema: false })).toEqual(
        [ENTRY]
      );
    }
  );

  it('shows the entry in a preview build, which is a production build on the preview schema', () => {
    expect(
      contentUploadMenuItems(superAdmin, {
        previewSchema: true,
        nodeEnv: 'production',
      })
    ).toEqual([ENTRY]);
  });

  it('does not show the entry in Production', () => {
    expect(
      contentUploadMenuItems(superAdmin, {
        previewSchema: false,
        nodeEnv: 'production',
      })
    ).toEqual([]);
    expect(
      contentUploadMenuItems(platformAdmin, {
        previewSchema: false,
        nodeEnv: 'production',
      })
    ).toEqual([]);
  });

  it.each([
    ['ADMIN of a customer organization', customerAdmin],
    ['TEMP_ADMIN', tempAdmin],
    ['TRAINER', trainer],
    ['TRAINEE', trainee],
    ['nobody', null],
    ['an unknown person', undefined],
  ])('never shows the entry to %s', (_n, subject) => {
    expect(
      contentUploadMenuItems(subject, {
        previewSchema: true,
        nodeEnv: 'development',
      })
    ).toEqual([]);
  });

  it('is a separate list: the entries of the admin menu are not changed by it', () => {
    expect(adminMenuItems(superAdmin).map(i => i.id)).toEqual([
      'adminOrgs',
      'adminUsers',
    ]);
  });

  it('opens a page that exists, and the routes behind it need the right to write curriculum content', () => {
    const page = path.join(
      process.cwd(),
      'src/app/trainer/admin/content-upload/page.tsx'
    );
    expect(fs.existsSync(page)).toBe(true);
    const base = path.join(process.cwd(), 'src/app/api/trainer/content-upload');
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'route.ts') routes.push(full);
      }
    };
    walk(base);
    expect(routes.length).toBeGreaterThan(5);
    for (const route of routes) {
      expect(fs.readFileSync(route, 'utf8')).toContain(
        'requireCurriculumEditor(request)'
      );
    }
  });
});
