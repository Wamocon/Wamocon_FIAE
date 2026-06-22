import { describe, it, expect, jest } from '@jest/globals';

// auth-helpers imports the Drizzle db client at module load; mock it so the
// pure role-mapping logic can be tested without a real DB connection.
jest.mock('@/db', () => ({ __esModule: true, default: {} }));

import { toHaiRole } from '@/lib/auth-helpers';

describe('lib/auth-helpers toHaiRole', () => {
  it('maps privileged roles to TRAINER', () => {
    expect(toHaiRole('ADMIN')).toBe('TRAINER');
    expect(toHaiRole('TEMP_ADMIN')).toBe('TRAINER');
    expect(toHaiRole('TRAINER')).toBe('TRAINER');
  });

  it('maps TRAINEE to TRAINEE', () => {
    expect(toHaiRole('TRAINEE')).toBe('TRAINEE');
  });

  it('falls back to TRAINEE for unknown, null, or undefined roles', () => {
    expect(toHaiRole('SOMETHING_ELSE')).toBe('TRAINEE');
    expect(toHaiRole(null)).toBe('TRAINEE');
    expect(toHaiRole(undefined)).toBe('TRAINEE');
    expect(toHaiRole('')).toBe('TRAINEE');
  });

  it('is case-sensitive (lowercase roles are not privileged)', () => {
    // Stored roles are uppercase; guard against accidental lowercase leaking in.
    expect(toHaiRole('admin')).toBe('TRAINEE');
    expect(toHaiRole('trainer')).toBe('TRAINEE');
  });
});
