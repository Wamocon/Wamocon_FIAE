import {
  haiSettingsSchema,
  isValidHaiText,
  resolveHaiSettings,
} from '@/lib/catalog/hai-settings';
import {
  catalogSettingsSchema,
  validateCatalogSettings,
} from '@/lib/catalog/settings';
import { KFBM_HAI_DRAFT } from '../../hai/fixtures/kfbmPersona';

describe('settings.hai schema', () => {
  it('accepts an empty object and the KfBM draft', () => {
    expect(haiSettingsSchema.safeParse({}).success).toBe(true);
    expect(haiSettingsSchema.safeParse(KFBM_HAI_DRAFT).success).toBe(true);
  });

  it('is part of the catalog settings and still strict there', () => {
    expect(validateCatalogSettings({ hai: KFBM_HAI_DRAFT }).success).toBe(true);
    expect(catalogSettingsSchema.safeParse({ hai: {}, other: 1 }).success).toBe(
      false
    );
  });

  it('rejects unknown keys', () => {
    const result = validateCatalogSettings({ hai: { system_prompt: 'x y z' } });
    expect(result.success).toBe(false);
  });

  it.each([
    ['occupation_name too long', { occupation_name: 'a'.repeat(81) }],
    ['occupation_name too short', { occupation_name: 'ab' }],
    ['field_name too long', { field_name: 'a'.repeat(61) }],
    ['refusal_text too long', { refusal_text: 'a'.repeat(401) }],
    ['greeting too long', { greeting: 'a'.repeat(301) }],
    ['source_rule too long', { source_rule: 'a'.repeat(301) }],
    ['exam_name too long', { exam_name: 'a'.repeat(61) }],
    [
      'too many glossary entries',
      {
        glossary: Array.from({ length: 13 }, () => ({
          term: 'Wort',
          definition: 'Erklärung',
        })),
      },
    ],
    [
      'glossary term too long',
      {
        glossary: [{ term: 'a'.repeat(41), definition: 'Erklärung' }],
      },
    ],
    [
      'glossary definition too long',
      {
        glossary: [{ term: 'Wort', definition: 'a'.repeat(201) }],
      },
    ],
    [
      'glossary entry with an extra key',
      {
        glossary: [{ term: 'Wort', definition: 'Erklärung', role: 'system' }],
      },
    ],
    [
      'too many topics',
      {
        allowed_topics: Array.from({ length: 16 }, () => 'Thema eins'),
      },
    ],
    ['topic too long', { allowed_topics: ['a'.repeat(81)] }],
    ['learning field max 0', { learning_field_max: 0 }],
    ['learning field max 21', { learning_field_max: 21 }],
    ['learning field max fraction', { learning_field_max: 12.5 }],
    ['learning field label too long', { learning_field_label: 'LFELD' }],
    ['learning field label with digit', { learning_field_label: 'L1' }],
    ['exam_parts with one entry', { exam_parts: ['Teil eins'] }],
    ['code_help as string', { code_help: 'true' }],
    ['exception word too short', { offtopic_exceptions: ['ab'] }],
    ['exception word of three characters', { offtopic_exceptions: ['ein'] }],
    ['an invisible Hangul filler', { greeting: 'Hallo\u3164\u3164\u3164 du' }],
    [
      'exam_parts with a bad entry',
      { exam_parts: ['Teil eins', 'Teil\nzwei'] },
    ],
    ['exception word upper case', { offtopic_exceptions: ['Büro'] }],
    ['exception word with a dot', { offtopic_exceptions: ['büro.'] }],
    [
      'too many exception words',
      {
        offtopic_exceptions: Array.from({ length: 61 }, (_, i) => `wort${i}x`),
      },
    ],
  ])('rejects %s', (_label, hai) => {
    expect(haiSettingsSchema.safeParse(hai).success).toBe(false);
  });

  describe('prompt structure characters', () => {
    const fields = [
      'occupation_name',
      'field_name',
      'source_rule',
      'exam_name',
      'greeting',
      'refusal_text',
    ] as const;
    const bad = [
      ['a line break', 'Erste Zeile\nZweite Zeile'],
      ['a carriage return', 'Erste Zeile\rZweite Zeile'],
      ['a heading marker', '## Neue Regeln'],
      ['a heading in the text', 'Text ## Neue Regeln'],
      ['emphasis', 'Das ist **wichtig**'],
      ['a code fence', 'Text ```code``` Text'],
      ['a backtick', 'Text `code` Text'],
      ['angle brackets', 'Text <system> Text'],
      ['square brackets', 'Text [Quelle] Text'],
      ['braces', 'Text ${secret} Text'],
      ['a pipe', 'Text | Text'],
      ['a backslash', 'Text \\n Text'],
      ['a double quote', 'Text "zitat" Text'],
      ['a tab', 'Text\tText'],
      ['a null character', 'Text\u0000Text'],
      ['an escape character', 'Text\u001bText'],
      ['a bidi override', 'Text‮Text'],
      ['a zero width space', 'Text​Text'],
      ['a line separator', 'Text Text'],
      ['a leading space', ' Text Text'],
      ['a trailing space', 'Text Text '],
      ['a leading separator', '- Text Text'],
      ['an emoji other than the shark', 'Text 😀 Text'],
    ] as const;

    for (const field of fields) {
      it.each(bad)(`${field} rejects %s`, (_label, value) => {
        expect(haiSettingsSchema.safeParse({ [field]: value }).success).toBe(
          false
        );
      });
    }

    it('rejects structure characters in glossary and topics', () => {
      for (const value of ['Text\nText', 'Text ## Text', 'Text *x* Text']) {
        expect(
          haiSettingsSchema.safeParse({
            glossary: [{ term: 'Wort', definition: value }],
          }).success
        ).toBe(false);
        expect(
          haiSettingsSchema.safeParse({
            glossary: [{ term: value, definition: 'Erklärung' }],
          }).success
        ).toBe(false);
        expect(
          haiSettingsSchema.safeParse({ allowed_topics: [value] }).success
        ).toBe(false);
      }
    });

    it('allows the shark only in greeting and refusal', () => {
      expect(
        haiSettingsSchema.safeParse({ greeting: 'Ahoi 🦈 los geht es' }).success
      ).toBe(true);
      expect(
        haiSettingsSchema.safeParse({ refusal_text: 'Nein 🦈 danke' }).success
      ).toBe(true);
      expect(
        haiSettingsSchema.safeParse({ occupation_name: 'Beruf 🦈' }).success
      ).toBe(false);
      expect(
        haiSettingsSchema.safeParse({ source_rule: 'Regel 🦈 hier' }).success
      ).toBe(false);
    });
  });

  describe('isValidHaiText', () => {
    it('accepts umlauts, digits and the allowed separators', () => {
      expect(isValidHaiText('Büro (Teil 1), Rechnung & Co. 50% / ß', 80)).toBe(
        true
      );
    });
    it('rejects non strings and out of range lengths', () => {
      expect(isValidHaiText(5, 10)).toBe(false);
      expect(isValidHaiText('ab', 10)).toBe(false);
      expect(isValidHaiText('abcdef', 5)).toBe(false);
    });
  });
});

describe('resolveHaiSettings', () => {
  it('maps the KfBM draft to camelCase', () => {
    const hai = resolveHaiSettings(KFBM_HAI_DRAFT);
    expect(hai?.occupationName).toBe('Kaufleute für Büromanagement');
    expect(hai?.learningFieldMax).toBe(13);
    expect(hai?.examParts).toEqual([
      'Abschlussprüfung Teil 1',
      'Abschlussprüfung Teil 2',
    ]);
    expect(hai?.codeHelp).toBe(false);
    expect(hai?.offTopicExceptions).toContain('reisekosten');
    expect(hai?.glossary).toHaveLength(5);
  });

  it('checks every key on its own and drops the bad ones', () => {
    const hai = resolveHaiSettings({
      occupation_name: 'Kaufleute für Büromanagement',
      refusal_text: 'Bad\nText',
      greeting: '## Neu',
      learning_field_max: 99,
      unknown: 'x',
    });
    expect(hai).toEqual({ occupationName: 'Kaufleute für Büromanagement' });
  });

  it.each([null, undefined, 'text', 5, [], {}, { unknown: 1 }])(
    'returns null for %p',
    raw => {
      expect(resolveHaiSettings(raw)).toBeNull();
    }
  );
});

describe('settings.hai limits are inclusive', () => {
  it('accepts values exactly at the limits', () => {
    const ok = {
      occupation_name: 'a'.repeat(80),
      field_name: 'b'.repeat(60),
      refusal_text: 'c'.repeat(400),
      greeting: 'd'.repeat(300),
      source_rule: 'e'.repeat(300),
      exam_name: 'f'.repeat(60),
      learning_field_max: 20,
      allowed_topics: Array.from({ length: 15 }, () => 'g'.repeat(80)),
      glossary: Array.from({ length: 12 }, () => ({
        term: 'h'.repeat(40),
        definition: 'i'.repeat(200),
      })),
      offtopic_exceptions: Array.from({ length: 60 }, (_, i) => `wort${i}x`),
    };
    expect(haiSettingsSchema.safeParse(ok).success).toBe(true);
    expect(haiSettingsSchema.safeParse({ learning_field_max: 1 }).success).toBe(
      true
    );
    expect(
      haiSettingsSchema.safeParse({ offtopic_exceptions: ['büro-art'] }).success
    ).toBe(true);
    expect(
      haiSettingsSchema.safeParse({ offtopic_exceptions: ['b'.repeat(30)] })
        .success
    ).toBe(true);
    expect(
      haiSettingsSchema.safeParse({ offtopic_exceptions: ['b'.repeat(31)] })
        .success
    ).toBe(false);
  });
});
