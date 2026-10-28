import {
  SignInBlockedError,
  isAccountStopped,
  isAwaitingActivation,
  isSignInBlockedError,
  loginPathWithReason,
  normalizeLoginReason,
  resolveAccessState,
  signedOutTarget,
  type AccessInput,
} from '@/lib/auth/access-state';

// The decision of the layouts: what a person sees in the trainee or trainer
// area. No case ends in a silent jump back to /login.

const trainee = { role: 'trainee', isActive: true, trainerActivated: true };
const trainer = { role: 'trainer', isActive: true, trainerActivated: true };

function state(overrides: Partial<AccessInput> = {}) {
  return resolveAccessState({
    area: 'trainee',
    loading: false,
    signedIn: true,
    profile: trainee,
    ...overrides,
  });
}

describe('resolveAccessState', () => {
  it('waits while the sign in state is determined', () => {
    expect(state({ loading: true })).toEqual({ kind: 'loading' });
    expect(state({ loading: true, signedIn: false, profile: null })).toEqual({
      kind: 'loading',
    });
  });

  it('sends only a person who is not signed in to the login', () => {
    expect(state({ signedIn: false, profile: null })).toEqual({
      kind: 'signedOut',
    });
  });

  it('waits for a profile that is still expected, then names the case', () => {
    expect(state({ profile: null, waitingForProfile: true })).toEqual({
      kind: 'loading',
    });
    expect(state({ profile: null, waitingForProfile: false })).toEqual({
      kind: 'blocked',
      reason: 'profileUnavailable',
    });
  });

  it('a trainee who waits for the release gets the notice, not a jump', () => {
    expect(state({ profile: { ...trainee, trainerActivated: false } })).toEqual(
      { kind: 'blocked', reason: 'awaitingActivation' }
    );
  });

  it('the release notice comes before the wrong area, nothing of the other area is named', () => {
    expect(
      state({
        area: 'trainer',
        profile: { ...trainee, trainerActivated: false },
      })
    ).toEqual({ kind: 'blocked', reason: 'awaitingActivation' });
  });

  it('only a trainee waits for a release: trainer level accounts with the flag false (scripts, database default) are not locked out', () => {
    for (const role of ['trainer', 'admin', 'super_admin', 'temp_admin']) {
      expect(
        state({
          area: 'trainer',
          profile: { ...trainer, role, trainerActivated: false },
        })
      ).toEqual({ kind: 'allowed' });
    }
  });

  it('a deactivated account has its own case, before the release', () => {
    expect(
      state({
        profile: { ...trainee, isActive: false, trainerActivated: false },
      })
    ).toEqual({ kind: 'blocked', reason: 'deactivated' });
  });

  it('a deactivated organization has its own case', () => {
    expect(
      state({ profile: { ...trainee, organization: { isActive: false } } })
    ).toEqual({ kind: 'blocked', reason: 'organizationDeactivated' });
    expect(
      state({ profile: { ...trainee, organization: { isActive: true } } })
    ).toEqual({ kind: 'allowed' });
  });

  it.each(['trainer', 'admin', 'super_admin', 'temp_admin'])(
    'a %s in the trainee area is told it is the wrong area',
    role => {
      expect(state({ profile: { ...trainee, role } })).toEqual({
        kind: 'blocked',
        reason: 'wrongArea',
      });
    }
  );

  it('a trainee in the trainer area is told it is the wrong area', () => {
    expect(state({ area: 'trainer', profile: trainee })).toEqual({
      kind: 'blocked',
      reason: 'wrongArea',
    });
  });

  it('allows the fitting role in its area', () => {
    expect(state()).toEqual({ kind: 'allowed' });
    expect(state({ area: 'trainer', profile: trainer })).toEqual({
      kind: 'allowed',
    });
    expect(
      state({ area: 'trainer', profile: { ...trainer, role: 'admin' } })
    ).toEqual({ kind: 'allowed' });
  });

  it('a missing release flag counts as released (as the profile loader maps it)', () => {
    expect(state({ profile: { role: 'trainee' } })).toEqual({
      kind: 'allowed',
    });
  });

  it('a trainee without an occupation is stopped in the trainee area only', () => {
    expect(state({ noCatalog: true })).toEqual({
      kind: 'blocked',
      reason: 'noCatalog',
    });
    expect(
      state({ area: 'trainer', profile: trainer, noCatalog: true })
    ).toEqual({ kind: 'allowed' });
  });
});

describe('isAwaitingActivation', () => {
  it('is true only for an explicit false', () => {
    expect(
      isAwaitingActivation({ role: 'trainee', trainerActivated: false })
    ).toBe(true);
    expect(
      isAwaitingActivation({ role: 'trainee', trainerActivated: true })
    ).toBe(false);
    expect(isAwaitingActivation({ role: 'trainee' })).toBe(false);
    expect(isAwaitingActivation(null)).toBe(false);
    // not for the roles the server does not hold back either
    expect(
      isAwaitingActivation({ role: 'trainer', trainerActivated: false })
    ).toBe(false);
  });
});

describe('isAccountStopped', () => {
  it('is true for an account that is not released, deactivated, or in a deactivated organization', () => {
    expect(isAccountStopped({ role: 'trainee', trainerActivated: false })).toBe(
      true
    );
    expect(isAccountStopped({ role: 'admin', trainerActivated: false })).toBe(
      false
    );
    expect(isAccountStopped({ isActive: false })).toBe(true);
    expect(isAccountStopped({ organization: { isActive: false } })).toBe(true);
  });

  it('is false for everybody else', () => {
    expect(isAccountStopped(null)).toBe(false);
    expect(isAccountStopped({})).toBe(false);
    expect(
      isAccountStopped({
        trainerActivated: true,
        isActive: true,
        organization: { isActive: true },
      })
    ).toBe(false);
    expect(isAccountStopped({ organization: null })).toBe(false);
  });
});

describe('normalizeLoginReason', () => {
  it('takes the known reasons, first value of a list', () => {
    expect(normalizeLoginReason('signin-required')).toBe('signin-required');
    expect(normalizeLoginReason('deactivated')).toBe('deactivated');
    expect(normalizeLoginReason(['organization-deactivated', 'x'])).toBe(
      'organization-deactivated'
    );
  });

  it('ignores everything else', () => {
    expect(normalizeLoginReason(undefined)).toBeNull();
    expect(normalizeLoginReason('')).toBeNull();
    expect(normalizeLoginReason('<script>')).toBeNull();
    expect(normalizeLoginReason('__proto__')).toBeNull();
    expect(normalizeLoginReason(42)).toBeNull();
    expect(normalizeLoginReason([])).toBeNull();
  });

  it('builds the login path with the reason', () => {
    expect(loginPathWithReason('deactivated')).toBe(
      '/login?reason=deactivated'
    );
  });
});

describe('signedOutTarget', () => {
  it('goes where the sign out went, or asks for a sign in', () => {
    expect(signedOutTarget(null)).toBe('/login?reason=signin-required');
    expect(signedOutTarget(undefined)).toBe('/login?reason=signin-required');
    expect(signedOutTarget('manual')).toBe('/');
    expect(signedOutTarget('deactivated')).toBe('/login?reason=deactivated');
    expect(signedOutTarget('organization-deactivated')).toBe(
      '/login?reason=organization-deactivated'
    );
  });
});

describe('SignInBlockedError', () => {
  it('carries a code and keeps the message', () => {
    const error = new SignInBlockedError('deactivated', 'Konto deaktiviert');
    expect(isSignInBlockedError(error)).toBe(true);
    expect(error.code).toBe('deactivated');
    expect(error.message).toBe('Konto deaktiviert');
    expect(error).toBeInstanceOf(Error);
    expect(isSignInBlockedError(new Error('x'))).toBe(false);
    expect(isSignInBlockedError(null)).toBe(false);
  });
});
