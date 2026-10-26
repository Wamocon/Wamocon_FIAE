import { describe, it, expect } from '@jest/globals';
import { canManageHaiIndex } from '@/lib/hai/indexAccess';

describe('canManageHaiIndex', () => {
  it.each([
    ['SUPER_ADMIN of any organization', 'SUPER_ADMIN', false],
    [
      'ADMIN of the platform organization (stands in for SUPER_ADMIN)',
      'ADMIN',
      true,
    ],
    ['TEMP_ADMIN of the platform organization', 'TEMP_ADMIN', true],
    ['TRAINER of the platform organization', 'TRAINER', true],
    ['trainer role in lower case is normalized', 'trainer', true],
  ])('allows %s', (_name, role, isPlatformOwner) => {
    expect(canManageHaiIndex({ role, isPlatformOwner })).toBe(true);
  });

  it.each([
    ['TRAINER of a customer organization', 'TRAINER', false],
    ['ADMIN of a customer organization', 'ADMIN', false],
    ['TEMP_ADMIN of a customer organization', 'TEMP_ADMIN', false],
    ['TRAINEE of the platform organization', 'TRAINEE', true],
    ['TRAINEE of a customer organization', 'TRAINEE', false],
    ['an unknown role of the platform organization', 'OWNER', true],
    ['a profile without a role', null, true],
  ])('denies %s', (_name, role, isPlatformOwner) => {
    expect(canManageHaiIndex({ role, isPlatformOwner })).toBe(false);
  });

  it('denies when there is no subject', () => {
    expect(canManageHaiIndex(null)).toBe(false);
    expect(canManageHaiIndex(undefined)).toBe(false);
  });

  it('needs the platform flag to be exactly true', () => {
    expect(canManageHaiIndex({ role: 'TRAINER', isPlatformOwner: null })).toBe(
      false
    );
    expect(canManageHaiIndex({ role: 'TRAINER' })).toBe(false);
  });
});
