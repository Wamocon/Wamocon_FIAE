/**
 * @jest-environment node
 */

// The server checks every proposal of the model (validate.ts): switch, role,
// page, intent of the person, form, fields, values. All or nothing.

import { isUiActionsEnabled } from '@/lib/hai/uiActions/config';
import { toUiActionEvent, uiActionMeta } from '@/lib/hai/uiActions/event';
import {
  validateFormTool,
  type UiValidationContext,
} from '@/lib/hai/uiActions/validate';
import { cleanFieldValue } from '@/lib/hai/uiActions/values';
import { getUiField, getUiForm } from '@/lib/hai/uiActions/registry';

function ctx(over: Partial<UiValidationContext> = {}): UiValidationContext {
  return {
    enabled: true,
    role: 'TRAINEE',
    pagePath: '/trainee/profile',
    intent: { fill: true, open: false },
    voice: false,
    ...over,
  };
}

const profile = (fields: Record<string, unknown>) => ({
  tool: 'fill_form',
  form: 'profile_name',
  fields,
});

describe('switch HAI_UI_ACTIONS', () => {
  it('is OFF without a value in every environment', () => {
    expect(isUiActionsEnabled({})).toBe(false);
    expect(isUiActionsEnabled({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(isUiActionsEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(isUiActionsEnabled({ VERCEL_ENV: 'production' })).toBe(false);
  });

  it('is on only with an explicit on value', () => {
    for (const value of ['on', 'ON', 'true', '1', 'yes', ' on ']) {
      expect(isUiActionsEnabled({ HAI_UI_ACTIONS: value })).toBe(true);
    }
    for (const value of ['off', 'false', '0', '', 'maybe', 'enabled']) {
      expect(isUiActionsEnabled({ HAI_UI_ACTIONS: value })).toBe(false);
    }
  });
});

describe('validateFormTool', () => {
  it('accepts a clean fill of the own profile name', () => {
    const result = validateFormTool(
      profile({ fullName: 'Max Mustermann' }),
      ctx()
    );
    expect(result).toEqual({
      ok: true,
      event: {
        tool: 'fill_form',
        form: 'profile_name',
        fields: [{ id: 'fullName', value: 'Max Mustermann' }],
        mode: 'apply',
      },
    });
  });

  it('rejects with the switch off, without role, without page and without intent', () => {
    const p = profile({ fullName: 'Max Mustermann' });
    expect(validateFormTool(p, ctx({ enabled: false }))).toEqual({
      ok: false,
      reason: 'switch_off',
    });
    expect(validateFormTool(p, ctx({ role: null }))).toEqual({
      ok: false,
      reason: 'no_role',
    });
    expect(validateFormTool(p, ctx({ pagePath: null }))).toEqual({
      ok: false,
      reason: 'no_page',
    });
    expect(
      validateFormTool(p, ctx({ intent: { fill: false, open: true } }))
    ).toEqual({ ok: false, reason: 'no_intent' });
  });

  it('rejects an unknown tool and a bad shape', () => {
    expect(
      validateFormTool({ tool: 'click', form: 'profile_name' }, ctx())
    ).toEqual({
      ok: false,
      reason: 'unknown_tool',
    });
    expect(validateFormTool({ tool: 'fill_form' }, ctx())).toEqual({
      ok: false,
      reason: 'bad_shape',
    });
    expect(
      validateFormTool(
        { tool: 'fill_form', form: 'profile_name', fields: ['x'] },
        ctx()
      )
    ).toEqual({ ok: false, reason: 'bad_shape' });
    expect(
      validateFormTool(
        { tool: 'fill_form', form: 'profile_name', fields: {} },
        ctx()
      )
    ).toEqual({ ok: false, reason: 'no_fields' });
  });

  it('rejects a foreign form, an excluded form and a foreign field', () => {
    expect(
      validateFormTool(
        { tool: 'fill_form', form: 'nope', fields: { a: 'b' } },
        ctx()
      )
    ).toEqual({ ok: false, reason: 'unknown_form' });
    expect(
      validateFormTool(
        { tool: 'fill_form', form: 'quiz_answer', fields: { answer: 'b' } },
        ctx()
      )
    ).toEqual({ ok: false, reason: 'excluded' });
    expect(
      validateFormTool(profile({ fullName: 'Max Muster', other: 'x' }), ctx())
    ).toEqual({
      ok: false,
      reason: 'unknown_field',
    });
    // one bad field drops the whole call (all or nothing)
    expect(
      validateFormTool(
        profile({ fullName: 'Max Muster', email: 'a@b.de' }),
        ctx()
      )
    ).toEqual({
      ok: false,
      reason: 'excluded',
    });
  });

  it.each(['email', 'password', 'role', 'iban', 'answer', 'solution'])(
    'rejects the excluded field %s',
    field => {
      expect(validateFormTool(profile({ [field]: 'x' }), ctx())).toEqual({
        ok: false,
        reason: 'excluded',
      });
    }
  );

  it('rejects a hostile key like __proto__ without effect', () => {
    const raw = JSON.parse(
      '{"tool":"fill_form","form":"profile_name","fields":{"__proto__":{"polluted":true}}}'
    );
    const result = validateFormTool(raw, ctx());
    expect(result.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a form of another page and the right page with the wrong role', () => {
    expect(
      validateFormTool(
        profile({ fullName: 'Max Muster' }),
        ctx({ pagePath: '/trainee/dashboard' })
      )
    ).toEqual({ ok: false, reason: 'wrong_page' });
    // the profile of the trainer area for a trainee
    expect(
      validateFormTool(
        profile({ fullName: 'Max Muster' }),
        ctx({ pagePath: '/trainer/profile' })
      )
    ).toEqual({ ok: false, reason: 'wrong_role' });
    // a trainee never gets the feedback text of a review
    expect(
      validateFormTool(
        {
          tool: 'fill_form',
          form: 'review_feedback',
          fields: { feedback: 'Gut' },
        },
        ctx({ pagePath: '/trainer/reviews' })
      )
    ).toEqual({ ok: false, reason: 'wrong_role' });
    // and not on a quiz page either
    expect(
      validateFormTool(
        profile({ fullName: 'Max Muster' }),
        ctx({ pagePath: '/trainee/quizzes' })
      )
    ).toEqual({ ok: false, reason: 'wrong_page' });
  });

  it('accepts the feedback text for a trainer on the review page', () => {
    const result = validateFormTool(
      {
        tool: 'fill_form',
        form: 'review_feedback',
        fields: { feedback: 'Gute Arbeit, bitte die Joins prüfen.' },
        entry: 2,
      },
      ctx({ role: 'TRAINER', pagePath: '/trainer/reviews' })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.entry).toBe(2);
  });

  it('rejects a too long value, a value below the minimum and a wrong type', () => {
    expect(
      validateFormTool(profile({ fullName: 'x'.repeat(101) }), ctx())
    ).toEqual({
      ok: false,
      reason: 'bad_value',
    });
    expect(validateFormTool(profile({ fullName: 'M' }), ctx())).toEqual({
      ok: false,
      reason: 'bad_value',
    });
    expect(validateFormTool(profile({ fullName: { a: 1 } }), ctx())).toEqual({
      ok: false,
      reason: 'bad_value',
    });
    expect(validateFormTool(profile({ fullName: ['Max'] }), ctx())).toEqual({
      ok: false,
      reason: 'bad_value',
    });
  });

  it('checks the entry: only for a form that occurs several times, an integer from 1', () => {
    const report = (entry: unknown) =>
      validateFormTool(
        {
          tool: 'fill_form',
          form: 'activity_report_entry',
          fields: { notes: 'SQL geübt' },
          entry,
        },
        ctx({ pagePath: '/trainee/activity-reports' })
      );
    expect(report(1).ok).toBe(true);
    expect(report(0)).toEqual({ ok: false, reason: 'bad_entry' });
    expect(report(1.5)).toEqual({ ok: false, reason: 'bad_entry' });
    expect(report('2')).toEqual({ ok: false, reason: 'bad_entry' });
    expect(report(99)).toEqual({ ok: false, reason: 'bad_entry' });
    // the profile occurs once: no entry
    expect(
      validateFormTool(
        { ...profile({ fullName: 'Max Muster' }), entry: 1 },
        ctx()
      )
    ).toEqual({ ok: false, reason: 'bad_entry' });
  });

  it('rejects more than 10 fields', () => {
    const fields = Object.fromEntries(
      Array.from({ length: 11 }, (_v, i) => [`f${i}`, 'x'])
    );
    expect(validateFormTool(profile(fields), ctx())).toEqual({
      ok: false,
      reason: 'too_many_fields',
    });
  });

  it('turns a spoken turn into the mode confirm', () => {
    const result = validateFormTool(
      profile({ fullName: 'Max Mustermann' }),
      ctx({ voice: true })
    );
    expect(result.ok && result.event.mode).toBe('confirm');
  });

  it('accepts focus and scroll without values, apply even when spoken', () => {
    const focus = validateFormTool(
      { tool: 'focus_field', form: 'profile_name', field: 'fullName' },
      ctx({ voice: true })
    );
    expect(focus).toEqual({
      ok: true,
      event: {
        tool: 'focus_field',
        form: 'profile_name',
        field: 'fullName',
        mode: 'apply',
      },
    });
    expect(
      validateFormTool({ tool: 'scroll_to', form: 'profile_name' }, ctx())
    ).toEqual({
      ok: true,
      event: { tool: 'scroll_to', form: 'profile_name', mode: 'apply' },
    });
    // focus needs a field, a field of another form is unknown
    expect(
      validateFormTool({ tool: 'focus_field', form: 'profile_name' }, ctx())
    ).toEqual({ ok: false, reason: 'no_fields' });
    expect(
      validateFormTool(
        { tool: 'focus_field', form: 'profile_name', field: 'feedback' },
        ctx()
      )
    ).toEqual({ ok: false, reason: 'unknown_field' });
    expect(
      validateFormTool(
        { tool: 'focus_field', form: 'profile_name', field: 'password' },
        ctx()
      )
    ).toEqual({ ok: false, reason: 'excluded' });
  });
});

describe('values', () => {
  const notes = getUiField(getUiForm('activity_report_entry')!, 'notes')!;
  const name = getUiField(getUiForm('profile_name')!, 'fullName')!;
  const hours = getUiField(getUiForm('activity_report_entry')!, 'hours')!;
  const status = getUiField(getUiForm('reviews_filter')!, 'status')!;
  const query = getUiField(getUiForm('trainees_search')!, 'query')!;

  it('removes control and invisible characters', () => {
    expect(cleanFieldValue(name, 'Max\u0000 Mus\u200Bter\u202Emann')).toEqual({
      ok: true,
      value: 'Max Mustermann',
    });
  });

  it('removes markup (tags and comments) but keeps a lone angle bracket', () => {
    expect(
      cleanFieldValue(
        notes,
        'Datenbank <b>geübt</b><script>alert(1)</script> <!-- x -->fertig'
      )
    ).toEqual({ ok: true, value: 'Datenbank geübtalert(1) fertig' });
    expect(cleanFieldValue(notes, 'Wert x < 5 geprüft')).toEqual({
      ok: true,
      value: 'Wert x < 5 geprüft',
    });
  });

  it('turns line breaks into spaces in a one line field and keeps them in a text area', () => {
    expect(cleanFieldValue(name, 'Max\nMustermann')).toEqual({
      ok: true,
      value: 'Max Mustermann',
    });
    expect(cleanFieldValue(notes, 'Zeile eins\n\n\n\nZeile zwei')).toEqual({
      ok: true,
      value: 'Zeile eins\n\nZeile zwei',
    });
  });

  it('rejects a value that is too long instead of cutting it', () => {
    expect(cleanFieldValue(notes, 'a'.repeat(1501))).toEqual({
      ok: false,
      reason: 'too_long',
    });
    expect(cleanFieldValue(notes, 'a'.repeat(1500)).ok).toBe(true);
    // a huge raw text is no input to clean
    expect(cleanFieldValue(notes, 'a'.repeat(100000))).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });

  it('rejects an empty value for a required text and allows it for a search', () => {
    expect(cleanFieldValue(notes, '   ')).toEqual({
      ok: false,
      reason: 'too_short',
    });
    expect(cleanFieldValue(query, '')).toEqual({ ok: true, value: '' });
  });

  it('checks numbers: range, step and form', () => {
    expect(cleanFieldValue(hours, 4)).toEqual({ ok: true, value: '4' });
    expect(cleanFieldValue(hours, '4,5')).toEqual({ ok: true, value: '4.5' });
    expect(cleanFieldValue(hours, 0)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(cleanFieldValue(hours, 41)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(cleanFieldValue(hours, 4.3)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(cleanFieldValue(hours, 'vier')).toEqual({
      ok: false,
      reason: 'type',
    });
    expect(cleanFieldValue(hours, NaN)).toEqual({ ok: false, reason: 'type' });
    expect(cleanFieldValue(hours, Infinity)).toEqual({
      ok: false,
      reason: 'type',
    });
  });

  it('checks a select against its list', () => {
    expect(cleanFieldValue(status, 'pending')).toEqual({
      ok: true,
      value: 'pending',
    });
    expect(cleanFieldValue(status, 'deleted')).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(cleanFieldValue(status, 3)).toEqual({ ok: false, reason: 'type' });
  });
});

describe('the event as the browser reads it', () => {
  const good = {
    tool: 'fill_form',
    form: 'profile_name',
    fields: [{ id: 'fullName', value: 'Max Mustermann' }],
    mode: 'apply',
  };

  it('takes a clean event and only the known members', () => {
    expect(toUiActionEvent({ ...good, extra: 'x' })).toEqual(good);
  });

  it('drops anything that is off', () => {
    expect(toUiActionEvent(null)).toBeUndefined();
    expect(toUiActionEvent([])).toBeUndefined();
    expect(toUiActionEvent({ ...good, tool: 'click' })).toBeUndefined();
    expect(toUiActionEvent({ ...good, form: 'quiz_answer' })).toBeUndefined();
    expect(toUiActionEvent({ ...good, fields: [] })).toBeUndefined();
    expect(
      toUiActionEvent({ ...good, fields: [{ id: 'email', value: 'a@b.de' }] })
    ).toBeUndefined();
    expect(
      toUiActionEvent({
        ...good,
        fields: [{ id: 'fullName', value: 'x'.repeat(200) }],
      })
    ).toBeUndefined();
    expect(
      toUiActionEvent({
        ...good,
        fields: [
          { id: 'fullName', value: 'Max Muster' },
          { id: 'fullName', value: 'Eva Muster' },
        ],
      })
    ).toBeUndefined();
    expect(toUiActionEvent({ ...good, entry: 1 })).toBeUndefined();
    expect(
      toUiActionEvent({ tool: 'focus_field', form: 'profile_name' })
    ).toBeUndefined();
  });

  it('keeps the mode confirm only for a fill', () => {
    expect(toUiActionEvent({ ...good, mode: 'confirm' })?.mode).toBe('confirm');
    expect(
      toUiActionEvent({
        tool: 'scroll_to',
        form: 'profile_name',
        mode: 'confirm',
      })?.mode
    ).toBe('apply');
  });

  it('stores identifiers only, never a value', () => {
    const event = toUiActionEvent({
      tool: 'fill_form',
      form: 'activity_report_entry',
      fields: [
        { id: 'notes', value: 'Sehr persönlicher Text' },
        { id: 'hours', value: '4' },
      ],
      mode: 'apply',
    })!;
    const meta = uiActionMeta(event);
    expect(meta).toEqual({
      tool: 'fill_form',
      form: 'activity_report_entry',
      fieldIds: ['notes', 'hours'],
      mode: 'apply',
    });
    expect(JSON.stringify(meta)).not.toContain('persönlich');
  });
});
