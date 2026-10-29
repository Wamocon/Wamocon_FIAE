import {
  MIN_PASSWORD_LENGTH,
  assertValidPassword,
  isValidPassword,
  passwordProblem,
} from '@/lib/auth/password-policy';
import { VALIDATION } from '@/lib/constants';
import { isValidPassword as isValidPasswordInUtils } from '@/lib/utils';
import { generateInitialPassword } from '@/lib/admin/initial-password';
import de from '@/locales/de.json';
import en from '@/locales/en.json';

// The one rule for a password: at least 8 characters, nothing else. Same
// minimum as the Supabase Auth setting of the project.

describe('password policy', () => {
  it('the minimum is 8, the same number as in the German message', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(VALIDATION.password.minLength).toBe(
      'Passwort muss mindestens 8 Zeichen lang sein'
    );
  });

  describe('passwordProblem', () => {
    it.each(['a', '123456', '1234567', '       '])(
      'the password %j is too short',
      password => {
        expect(passwordProblem(password)).toBe(VALIDATION.password.minLength);
        expect(isValidPassword(password)).toBe(false);
      }
    );

    it('missing values count as missing (German message), whatever the type', () => {
      for (const value of [undefined, null, 123456789, {}, [], true, '']) {
        expect(passwordProblem(value)).toBe(VALIDATION.password.required);
        expect(isValidPassword(value)).toBe(false);
      }
    });

    it('8 characters are enough, no other demand (no digit, no case, no symbol)', () => {
      for (const password of [
        '12345678',
        'aaaaaaaa',
        'AAAAAAAA',
        'passwort',
        '        ',
        'äöüß äöü',
      ]) {
        expect(passwordProblem(password)).toBeNull();
        expect(isValidPassword(password)).toBe(true);
      }
    });

    it('does not trim: the characters count as typed', () => {
      expect(isValidPassword('ab    cd')).toBe(true);
      expect(isValidPassword(' abcdef ')).toBe(true);
    });
  });

  describe('assertValidPassword', () => {
    it('throws with the label and the German message, for scripts', () => {
      expect(() => assertValidPassword('short', 'TEST_USER_PASSWORD')).toThrow(
        'TEST_USER_PASSWORD: Passwort muss mindestens 8 Zeichen lang sein'
      );
      expect(() => assertValidPassword(undefined)).toThrow(
        'Passwort: Passwort ist erforderlich'
      );
    });

    it('does nothing for a valid password', () => {
      expect(() => assertValidPassword('long-enough')).not.toThrow();
    });
  });

  it('isValidPassword of utils is the same rule', () => {
    expect(isValidPasswordInUtils('1234567')).toBe(false);
    expect(isValidPasswordInUtils('12345678')).toBe(true);
  });

  describe('the texts of the screens say 8 as well', () => {
    const keys = [
      'register.passwordMinLength',
      'resetPassword.passwordMinLength',
      'profile.passwordMinLength',
    ];
    it.each(keys)('%s (German)', key => {
      expect((de as Record<string, string>)[key]).toMatch(
        /mindestens 8 Zeichen/
      );
    });
    it.each(keys)('%s (English)', key => {
      expect((en as Record<string, string>)[key]).toMatch(
        /at least 8 characters/
      );
    });
    it('no German or English text still names 6 as the minimum', () => {
      const all = [...Object.values(de), ...Object.values(en)] as string[];
      const stale = all.filter(
        text =>
          /mindestens 6 Zeichen/.test(text) ||
          /at least 6 characters/.test(text)
      );
      expect(stale).toEqual([]);
    });
  });
});

describe('generateInitialPassword (accounts created by an administrator)', () => {
  it('is 12 characters by default and satisfies the rule', () => {
    const password = generateInitialPassword();
    expect(password).toHaveLength(12);
    expect(isValidPassword(password)).toBe(true);
  });

  it('is never shorter than the minimum, whatever length is asked for', () => {
    expect(generateInitialPassword(3)).toHaveLength(MIN_PASSWORD_LENGTH);
    expect(generateInitialPassword(0)).toHaveLength(MIN_PASSWORD_LENGTH);
    expect(generateInitialPassword(20)).toHaveLength(20);
  });

  it('has no look-alike characters and differs from call to call', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const password = generateInitialPassword();
      expect(password).not.toMatch(/[IlO01]/);
      seen.add(password);
    }
    expect(seen.size).toBe(50);
  });
});
