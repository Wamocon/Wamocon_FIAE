import { describe, it, expect } from '@jest/globals';
import {
  ROLE_NOT_ASSIGNABLE,
  checkRoleForCreate,
  checkRoleForUpdate,
} from '@/lib/admin/roleAssignment';

// Who may hand out which role. The two checks sit between the request and the
// write of POST and PATCH /api/admin/users. Unknown role values stay 400, a
// known role the caller may not hand out is 403.

const superAdmin = { role: 'SUPER_ADMIN', isPlatformOwner: true };
const platformAdmin = { role: 'ADMIN', isPlatformOwner: true };
const admin = { role: 'ADMIN', isPlatformOwner: false };
const tempAdmin = { role: 'TEMP_ADMIN', isPlatformOwner: false };
const trainer = { role: 'TRAINER', isPlatformOwner: false };

describe('checkRoleForCreate', () => {
  it.each([
    ['SUPER_ADMIN', superAdmin],
    ['platform ADMIN', platformAdmin],
    ['ADMIN', admin],
  ])('%s may create a TEMP_ADMIN, a TRAINER and a TRAINEE', (_n, subject) => {
    for (const role of ['TEMP_ADMIN', 'TRAINER', 'TRAINEE']) {
      expect(checkRoleForCreate(subject, role)).toEqual({ ok: true, role });
    }
  });

  it('TEMP_ADMIN may create trainers and trainees only', () => {
    expect(checkRoleForCreate(tempAdmin, 'TRAINER')).toEqual({
      ok: true,
      role: 'TRAINER',
    });
    expect(checkRoleForCreate(tempAdmin, 'TRAINEE')).toEqual({
      ok: true,
      role: 'TRAINEE',
    });
    expect(checkRoleForCreate(tempAdmin, 'TEMP_ADMIN')).toMatchObject({
      ok: false,
      status: 403,
      code: ROLE_NOT_ASSIGNABLE,
    });
    expect(checkRoleForCreate(tempAdmin, 'ADMIN')).toMatchObject({
      ok: false,
      status: 403,
      code: ROLE_NOT_ASSIGNABLE,
    });
  });

  it('nobody creates a SUPER_ADMIN, an ADMIN may not even try it (403)', () => {
    for (const subject of [superAdmin, platformAdmin, admin, tempAdmin]) {
      expect(checkRoleForCreate(subject, 'SUPER_ADMIN')).toMatchObject({
        ok: false,
        status: 403,
        code: ROLE_NOT_ASSIGNABLE,
      });
    }
  });

  it('ADMIN is not created through POST, as before (400 for the platform admin, 403 below)', () => {
    expect(checkRoleForCreate(superAdmin, 'ADMIN')).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(checkRoleForCreate(admin, 'ADMIN')).toMatchObject({
      ok: false,
      status: 403,
      code: ROLE_NOT_ASSIGNABLE,
    });
  });

  it('answers 400 for values that are no role', () => {
    for (const value of ['ROOT', '', undefined, null, 7, {}]) {
      expect(checkRoleForCreate(admin, value)).toMatchObject({
        ok: false,
        status: 400,
        error: 'Invalid role. Use TEMP_ADMIN, TRAINER, or TRAINEE.',
      });
    }
  });

  it('is not case sensitive and trims, like the route did', () => {
    expect(checkRoleForCreate(admin, ' trainee ')).toEqual({
      ok: true,
      role: 'TRAINEE',
    });
  });

  it('a trainer or a missing subject may create nothing', () => {
    expect(checkRoleForCreate(trainer, 'TRAINEE')).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkRoleForCreate(null, 'TRAINEE')).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('the 403 text names the role and what the caller may hand out', () => {
    const result = checkRoleForCreate(tempAdmin, 'TEMP_ADMIN');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('TEMP_ADMIN');
      expect(result.error).toContain('TRAINER');
      expect(result.error).toContain('TRAINEE');
    }
  });
});

describe('checkRoleForUpdate', () => {
  it('the platform admin sets every role below SUPER_ADMIN', () => {
    for (const role of ['ADMIN', 'TEMP_ADMIN', 'TRAINER', 'TRAINEE']) {
      expect(checkRoleForUpdate(superAdmin, role, 'TRAINER')).toEqual({
        ok: true,
        role,
      });
    }
  });

  it('ADMIN promotes to ADMIN as before and sets TEMP_ADMIN, TRAINER and TRAINEE', () => {
    for (const role of ['ADMIN', 'TEMP_ADMIN', 'TRAINER', 'TRAINEE']) {
      expect(checkRoleForUpdate(admin, role, 'TRAINEE')).toEqual({
        ok: true,
        role,
      });
    }
  });

  it('ADMIN never sets SUPER_ADMIN', () => {
    expect(checkRoleForUpdate(admin, 'SUPER_ADMIN', 'TRAINER')).toMatchObject({
      ok: false,
      status: 403,
      code: ROLE_NOT_ASSIGNABLE,
    });
    expect(
      checkRoleForUpdate(platformAdmin, 'SUPER_ADMIN', 'TRAINER')
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      checkRoleForUpdate(superAdmin, 'SUPER_ADMIN', 'TRAINER')
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('TEMP_ADMIN neither promotes to TEMP_ADMIN nor to ADMIN', () => {
    expect(
      checkRoleForUpdate(tempAdmin, 'TEMP_ADMIN', 'TRAINER')
    ).toMatchObject({ ok: false, status: 403, code: ROLE_NOT_ASSIGNABLE });
    expect(checkRoleForUpdate(tempAdmin, 'ADMIN', 'TRAINEE')).toMatchObject({
      ok: false,
      status: 403,
      code: ROLE_NOT_ASSIGNABLE,
    });
    expect(checkRoleForUpdate(tempAdmin, 'TRAINER', 'TRAINEE')).toEqual({
      ok: true,
      role: 'TRAINER',
    });
    expect(checkRoleForUpdate(tempAdmin, 'TRAINEE', 'TRAINER')).toEqual({
      ok: true,
      role: 'TRAINEE',
    });
  });

  it('the same role as today is no change and always passes', () => {
    // a client may send the whole record, the role did not change
    expect(checkRoleForUpdate(tempAdmin, 'TEMP_ADMIN', 'TEMP_ADMIN')).toEqual({
      ok: true,
      role: 'TEMP_ADMIN',
    });
    expect(checkRoleForUpdate(admin, 'admin', 'ADMIN')).toEqual({
      ok: true,
      role: 'ADMIN',
    });
  });

  it('answers 400 for values that are no role', () => {
    for (const value of ['ROOT', '', null, undefined, 7]) {
      expect(checkRoleForUpdate(admin, value, 'TRAINER')).toMatchObject({
        ok: false,
        status: 400,
        error: 'Invalid role',
      });
    }
  });

  it('a trainer may set nothing', () => {
    expect(checkRoleForUpdate(trainer, 'TRAINEE', 'TRAINER')).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});
