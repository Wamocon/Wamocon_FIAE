/**
 * @jest-environment node
 */

// Register of the forms the HAI may fill (docs/hai-ui-aktionen.md, section 5):
// every mandatory rule is checked for every form and every field, so a later
// entry cannot slip in an answer field, a password or a page of a quiz.

import fs from 'fs';
import path from 'path';
import { pageKindForPath } from '@/lib/hai/pageContext/shared';
import {
  ALLOWED_FORM_PAGE_KINDS,
  MAX_FIELDS_PER_CALL,
  UI_FORMS,
  areaOfPath,
  formAllowedFor,
  formIsOnPath,
  formsForPage,
  getUiField,
  getUiForm,
  isExcludedField,
  normalizeUiPath,
} from '@/lib/hai/uiActions/registry';

const ROOT = process.cwd();

describe('register of the forms', () => {
  it('has unique form ids and unique field ids per form', () => {
    const ids = UI_FORMS.map(form => form.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const form of UI_FORMS) {
      const fields = form.fields.map(field => field.id);
      expect(new Set(fields).size).toBe(fields.length);
    }
  });

  it.each(UI_FORMS.map(form => [form.id, form] as const))(
    '%s: fixed routes without placeholders, on an allowed kind of page',
    (_id, form) => {
      expect(form.paths.length).toBeGreaterThan(0);
      for (const route of form.paths) {
        expect(route).toMatch(/^\/[a-z0-9/-]+$/);
        expect(route).not.toMatch(/\[|\]|\*|:/);
        // the kind is the one the server derives from the path
        expect(ALLOWED_FORM_PAGE_KINDS).toContain(pageKindForPath(route));
        // the page of a quiz, an enabler or a use case is never a form page
        expect([
          'quiz',
          'enabler',
          'use_case',
          'course',
          'lernfeld',
        ]).not.toContain(pageKindForPath(route));
        expect(
          fs.existsSync(path.join(ROOT, 'src/app', route, 'page.tsx'))
        ).toBe(true);
      }
    }
  );

  it.each(UI_FORMS.map(form => [form.id, form] as const))(
    '%s: the area of every path fits a role of the form, and the role list is not empty',
    (_id, form) => {
      expect(form.roles.length).toBeGreaterThan(0);
      for (const route of form.paths) {
        const area = areaOfPath(route);
        expect(area).not.toBeNull();
        expect(form.roles).toContain(area);
      }
    }
  );

  it.each(UI_FORMS.map(form => [form.id, form] as const))(
    '%s: no excluded id, a label, and at most 10 fields',
    (_id, form) => {
      expect(isExcludedField(form.id)).toBe(false);
      expect(form.label.length).toBeGreaterThan(2);
      expect(form.fields.length).toBeGreaterThan(0);
      expect(form.fields.length).toBeLessThanOrEqual(MAX_FIELDS_PER_CALL);
      for (const field of form.fields) {
        expect(isExcludedField(field.id)).toBe(false);
        expect(field.label.length).toBeGreaterThan(1);
      }
    }
  );

  it('every field has a type with limits (text and range are bounded, a select has a list)', () => {
    for (const form of UI_FORMS) {
      for (const field of form.fields) {
        if (field.type === 'text' || field.type === 'textarea') {
          expect(field.maxLength).toBeGreaterThan(0);
          expect(field.maxLength).toBeLessThanOrEqual(2000);
          expect(field.minLength ?? 0).toBeLessThanOrEqual(field.maxLength!);
        } else if (field.type === 'number') {
          expect(Number.isFinite(field.min)).toBe(true);
          expect(Number.isFinite(field.max)).toBe(true);
          expect(field.max!).toBeGreaterThan(field.min!);
        } else if (field.type === 'select') {
          expect(field.options!.length).toBeGreaterThan(1);
          expect(new Set(field.options).size).toBe(field.options!.length);
        } else {
          throw new Error(`unknown type of ${form.id}.${field.id}`);
        }
        expect(typeof field.sensitive).toBe('boolean');
      }
    }
  });

  it('marks every field with personal content as sensitive', () => {
    const personal = ['notes', 'fullName', 'feedback'];
    for (const form of UI_FORMS) {
      for (const field of form.fields) {
        if (personal.includes(field.id)) expect(field.sensitive).toBe(true);
      }
    }
    // a search and a filter hold no personal content
    expect(getUiField(getUiForm('reviews_search')!, 'query')!.sensitive).toBe(
      false
    );
  });

  it('finds the data attributes of every form and field in the source of the pages', () => {
    const sources = [
      'src/app/trainee/activity-reports/page.tsx',
      'src/components/profile/Profile.tsx',
      'src/app/trainer/reviews/page.tsx',
      'src/app/trainer/trainees/page.tsx',
    ]
      .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8'))
      .join('\n');
    for (const form of UI_FORMS) {
      expect(sources).toContain(`data-hai-form="${form.id}"`);
      for (const field of form.fields) {
        expect(sources).toContain(`data-hai-field="${field.id}"`);
      }
    }
  });

  it('keeps the HAI panel out of the forms (data-hai-ignore stays on the chat)', () => {
    const chat = fs.readFileSync(
      path.join(ROOT, 'src/components/hai/HaiChat.tsx'),
      'utf8'
    );
    expect(chat).toContain('data-hai-ignore');
    expect(chat).not.toContain('data-hai-form');
  });
});

describe('exclusions', () => {
  it.each([
    'answer',
    'antwort',
    'quizAnswer',
    'solution',
    'musterloesung',
    'password',
    'passwort',
    'newPassword',
    'email',
    'e_mail',
    'role',
    'rolle',
    'permissions',
    'payment',
    'zahlung',
    'iban',
    'creditCard',
    'exam_input',
    'pruefung',
    'klausur_text',
    'quiz_response',
    'scenario_text',
    'szenario',
    'use_case_submission',
    'abgabe',
    'delete_account',
    'submitButton',
  ])('%s is excluded', id => {
    expect(isExcludedField(id)).toBe(true);
  });

  it('treats a missing or non text id as excluded', () => {
    expect(isExcludedField('')).toBe(true);
    expect(isExcludedField(undefined)).toBe(true);
    expect(isExcludedField(42)).toBe(true);
  });

  it('never returns a form or a field of the excluded list, also if it were registered', () => {
    expect(getUiForm('quiz_answer')).toBeUndefined();
    expect(getUiForm('password_change')).toBeUndefined();
    const form = getUiForm('profile_name')!;
    expect(getUiField(form, 'email')).toBeUndefined();
    expect(getUiField(form, 'role')).toBeUndefined();
  });
});

describe('page and role', () => {
  it('normalizes a path (query, hash, trailing slash)', () => {
    expect(normalizeUiPath('/trainer/reviews/?tab=quizzes#x')).toBe(
      '/trainer/reviews'
    );
    expect(normalizeUiPath('/')).toBe('/');
    expect(normalizeUiPath(5)).toBe('');
  });

  it('finds a form only on its own page', () => {
    const form = getUiForm('profile_name')!;
    expect(formIsOnPath(form, '/trainee/profile')).toBe(true);
    expect(formIsOnPath(form, '/trainer/profile/')).toBe(true);
    expect(formIsOnPath(form, '/trainee/dashboard')).toBe(false);
    expect(formIsOnPath(form, '/trainee/profile/extra')).toBe(false);
  });

  it('lets a trainee use the profile only on the trainee path and a trainer only on the trainer path', () => {
    const form = getUiForm('profile_name')!;
    expect(formAllowedFor(form, 'TRAINEE', '/trainee/profile')).toBe(true);
    expect(formAllowedFor(form, 'TRAINER', '/trainer/profile')).toBe(true);
    expect(formAllowedFor(form, 'TRAINEE', '/trainer/profile')).toBe(false);
    expect(formAllowedFor(form, 'TRAINER', '/trainee/profile')).toBe(false);
  });

  it('gives a trainee no form of the trainer area, and a trainer none of the trainee area', () => {
    expect(formsForPage('TRAINEE', '/trainer/reviews')).toEqual([]);
    expect(formsForPage('TRAINEE', '/trainer/trainees')).toEqual([]);
    expect(formsForPage('TRAINER', '/trainee/activity-reports')).toEqual([]);
  });

  it('gives a trainee nothing on a page of a quiz, an enabler or a use case', () => {
    for (const route of [
      '/trainee/quizzes',
      '/trainee/enablers/20000000-0000-4000-8000-000000000001',
      '/trainee/use-cases/20000000-0000-4000-8000-000000000001',
      '/trainee/dashboard',
      '/trainee/school',
    ]) {
      expect(formsForPage('TRAINEE', route)).toEqual([]);
    }
  });

  it('lists the forms of the review page for a trainer', () => {
    expect(formsForPage('TRAINER', '/trainer/reviews').map(f => f.id)).toEqual([
      'review_feedback',
      'reviews_search',
      'reviews_filter',
    ]);
  });
});
