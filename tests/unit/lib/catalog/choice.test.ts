import {
  OCCUPATION_CHOICE_PATH,
  dashboardPathForRole,
  needsOccupationChoice,
} from '@/lib/catalog/choice';

describe('needsOccupationChoice', () => {
  it('is false for a platform with one active occupation (today: FIAE only)', () => {
    for (const link of ['none', 'allowed', 'denied', 'unknown'] as const) {
      expect(needsOccupationChoice({ activeCatalogCount: 1, link })).toBe(
        false
      );
    }
  });

  it('is false when the number of occupations is not known or zero', () => {
    expect(
      needsOccupationChoice({ activeCatalogCount: null, link: 'none' })
    ).toBe(false);
    expect(needsOccupationChoice({ activeCatalogCount: 0, link: 'none' })).toBe(
      false
    );
  });

  it('is true after a plain sign in on a platform with several occupations', () => {
    expect(needsOccupationChoice({ activeCatalogCount: 2, link: 'none' })).toBe(
      true
    );
  });

  it('is false when the login link already chose an occupation the account has', () => {
    expect(
      needsOccupationChoice({ activeCatalogCount: 2, link: 'allowed' })
    ).toBe(false);
  });

  it('is true when the login link chose an occupation the account does not have', () => {
    expect(
      needsOccupationChoice({ activeCatalogCount: 3, link: 'denied' })
    ).toBe(true);
  });

  it('is false when the check of the login link failed (the sign in goes on as before)', () => {
    expect(
      needsOccupationChoice({ activeCatalogCount: 2, link: 'unknown' })
    ).toBe(false);
  });
});

describe('dashboardPathForRole', () => {
  it.each([
    ['trainee', '/trainee/dashboard'],
    ['TRAINEE', '/trainee/dashboard'],
    ['trainer', '/trainer/dashboard'],
    ['TRAINER', '/trainer/dashboard'],
    ['admin', '/trainer/dashboard'],
    ['temp_admin', '/trainer/dashboard'],
    ['TEMP_ADMIN', '/trainer/dashboard'],
    ['super_admin', '/trainer/dashboard'],
    ['SUPER_ADMIN', '/trainer/dashboard'],
    ['something else', '/trainee/dashboard'],
    [null, '/trainee/dashboard'],
    [undefined, '/trainee/dashboard'],
  ])('sends %p to %s', (role, path) => {
    expect(dashboardPathForRole(role)).toBe(path);
  });
});

it('names the occupation choice page', () => {
  expect(OCCUPATION_CHOICE_PATH).toBe('/berufswahl');
});
