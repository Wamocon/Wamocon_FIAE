/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  STATIC_TARGETS,
  STATIC_TARGET_IDS,
  pathOfEnabler,
  isAllowedNavigationPath,
  staticTargetFor,
  targetsForLevel,
  pathOfUseCase,
  type NavigationLevel,
} from '@/lib/hai/navigation/targets';
import { toNavigationOffer } from '@/lib/hai/navigation/offer';

// The allow list of the navigation targets: the real routes of src/app, the
// right set per level, and nothing outside of it.

const ENABLER = '20000000-0000-4000-8000-000000000001';

function routeFile(urlPath: string): string {
  const clean = urlPath.split('?')[0];
  return path.join(
    process.cwd(),
    'src',
    'app',
    ...clean.split('/'),
    'page.tsx'
  );
}

describe('the allow list holds real routes only', () => {
  const all = STATIC_TARGET_IDS.flatMap(id =>
    Object.entries(STATIC_TARGETS[id]).map(
      ([level, target]) => [id, level, target.path] as const
    )
  );

  it.each(all)('%s for %s: %s exists in src/app', (_id, _level, urlPath) => {
    expect(fs.existsSync(routeFile(urlPath))).toBe(true);
  });

  it('has the pages of the record shapes in src/app', () => {
    expect(
      fs.existsSync(
        path.join(
          process.cwd(),
          'src/app/trainee/enablers/[enablerId]/page.tsx'
        )
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          process.cwd(),
          'src/app/trainee/use-cases/[useCaseId]/page.tsx'
        )
      )
    ).toBe(true);
  });

  it('gives every target a label and a reason without a dash or an address', () => {
    for (const [, , urlPath] of all) expect(urlPath.startsWith('/')).toBe(true);
    for (const id of STATIC_TARGET_IDS) {
      for (const target of Object.values(STATIC_TARGETS[id])) {
        expect(target.label.length).toBeGreaterThan(2);
        expect(target.reason.endsWith('.')).toBe(true);
        expect(`${target.label} ${target.reason}`).not.toMatch(/[–—]|https?:/);
      }
    }
  });
});

describe('the targets per level', () => {
  const ids = (level: NavigationLevel) => targetsForLevel(level).map(t => t.id);

  it('a trainee gets the pages of a trainee and none of the trainer area', () => {
    expect(ids('TRAINEE')).toEqual([
      'dashboard',
      'activity_reports',
      'school',
      'calendar',
      'profile',
      'quizzes',
      // the menu entries "Lernen" and "Ausbilder-Feedback"
      'courses',
      'trainer_feedback',
      'evaluations',
    ]);
    for (const target of targetsForLevel('TRAINEE')) {
      expect(target.path.startsWith('/trainee/')).toBe(true);
    }
  });

  it('a trainer gets the trainer pages and no admin page', () => {
    expect(ids('TRAINER')).toEqual([
      'dashboard',
      'activity_reports',
      'school',
      'calendar',
      'profile',
      'quizzes',
      // the courses of the trainer level are managed in the content management
      'courses',
      'trainees',
      'reviews',
      'content_management',
      'statistics',
      'evaluations',
      'certificate',
    ]);
    for (const target of targetsForLevel('TRAINER')) {
      expect(target.path.startsWith('/trainer/')).toBe(true);
      expect(target.path).not.toContain('/admin/');
    }
  });

  it('an admin level has the trainer pages and the admin pages on top', () => {
    const admin = ids('ADMIN');
    for (const id of ids('TRAINER')) expect(admin).toContain(id);
    expect(admin).toContain('organizations');
    expect(admin).toContain('users');
    // the statistics of the admin levels is the content statistics
    expect(staticTargetFor('statistics', 'ADMIN')?.path).toBe(
      '/trainer/admin/content-stats'
    );
    expect(staticTargetFor('statistics', 'TRAINER')?.path).toBe(
      '/trainer/dashboard'
    );
  });

  it('refuses the page of another level', () => {
    expect(staticTargetFor('trainees', 'TRAINEE')).toBeNull();
    expect(staticTargetFor('reviews', 'TRAINEE')).toBeNull();
    expect(staticTargetFor('organizations', 'TRAINER')).toBeNull();
    expect(staticTargetFor('users', 'TRAINEE')).toBeNull();
    expect(staticTargetFor('content_management', 'TRAINEE')).toBeNull();
    // the feedback page is a page of the trainees only
    expect(staticTargetFor('trainer_feedback', 'TRAINER')).toBeNull();
    expect(staticTargetFor('trainer_feedback', 'ADMIN')).toBeNull();
  });

  it('gives the menu entry "Lernen" to a trainee and the content management to the trainer levels', () => {
    expect(staticTargetFor('courses', 'TRAINEE')?.path).toBe(
      '/trainee/courses'
    );
    expect(staticTargetFor('courses', 'TRAINEE')?.label).toBe('Lernen');
    expect(staticTargetFor('courses', 'TRAINER')?.path).toBe(
      '/trainer/content-management'
    );
    expect(staticTargetFor('courses', 'ADMIN')?.path).toBe(
      '/trainer/content-management'
    );
    expect(staticTargetFor('trainer_feedback', 'TRAINEE')?.path).toBe(
      '/trainee/trainer-feedback'
    );
  });

  it('keeps the calendar of a trainee on the school page, as the sidebar does', () => {
    expect(staticTargetFor('calendar', 'TRAINEE')?.path).toBe(
      '/trainee/school?tab=calendar'
    );
  });
});

describe('isAllowedNavigationPath', () => {
  it('accepts the static pages and the page of an enabler or a use case', () => {
    expect(isAllowedNavigationPath('/trainee/dashboard')).toBe(true);
    expect(isAllowedNavigationPath('/trainer/admin/users')).toBe(true);
    expect(isAllowedNavigationPath(pathOfEnabler(ENABLER))).toBe(true);
    expect(isAllowedNavigationPath(pathOfUseCase(ENABLER))).toBe(true);
  });

  it.each([
    '/trainer/admin/secret',
    '/trainee/dashboard/',
    '/trainee/dashboard?x=1',
    '//evil.example/trainee/dashboard',
    'https://evil.example/trainee/dashboard',
    'javascript:alert(1)',
    '/trainee/enablers/not-a-uuid',
    `/trainee/enablers/${ENABLER}/quiz`,
    `/trainee/enablers/${ENABLER}/../../trainer/admin/users`,
    '/trainee/enablers/../../trainer/admin/users',
    '/api/hai/action',
    '',
  ])('refuses %s', value => {
    expect(isAllowedNavigationPath(value)).toBe(false);
  });

  it('refuses something that is not a string', () => {
    for (const value of [undefined, null, 5, {}, ['/trainee/dashboard']]) {
      expect(isAllowedNavigationPath(value)).toBe(false);
    }
  });

  it('builds a record path only from a uuid', () => {
    expect(pathOfEnabler('abc')).toBeNull();
    expect(pathOfUseCase("1' OR '1'='1")).toBeNull();
    expect(pathOfEnabler(ENABLER.toUpperCase())).toBe(
      `/trainee/enablers/${ENABLER}`
    );
  });
});

describe('toNavigationOffer (what the client reads)', () => {
  const good = {
    path: '/trainee/school',
    label: 'Berufsschule',
    reason: 'Dort findest du den Stundenplan.',
  };

  it('takes an offer with an allowed path and only its known members', () => {
    expect(toNavigationOffer({ ...good, extra: 'x', status: 'open' })).toEqual(
      good
    );
  });

  it('takes the mark auto only when it is exactly true', () => {
    expect(toNavigationOffer({ ...good, auto: true })).toEqual({
      ...good,
      auto: true,
    });
    for (const auto of [false, 'true', 1, null, {}, []]) {
      expect(toNavigationOffer({ ...good, auto })).toEqual(good);
    }
  });

  it('never marks an offer with a path outside the list as auto', () => {
    expect(
      toNavigationOffer({ ...good, path: '/trainer/admin/secret', auto: true })
    ).toBeUndefined();
  });

  it.each([
    [{ ...good, path: '/trainer/admin/secret' }],
    [{ ...good, path: 'https://evil.example' }],
    [{ ...good, label: '' }],
    [{ ...good, reason: 5 }],
    [null],
    ['text'],
    [[good]],
  ])('drops a malformed or foreign offer: %j', raw => {
    expect(toNavigationOffer(raw)).toBeUndefined();
  });

  it('cuts a very long text and removes control characters', () => {
    const offer = toNavigationOffer({
      ...good,
      label: `A\u0000B${'x'.repeat(500)}`,
    });
    expect(offer?.label.length).toBeLessThanOrEqual(200);
    expect(offer?.label).not.toContain('\u0000');
  });
});
