import de from '@/locales/de.json';
import en from '@/locales/en.json';

const pick = (map: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(map).filter(([key]) => key.startsWith('contentCheck.'))
  );
const deKeys = pick(de as Record<string, string>);
const enKeys = pick(en as Record<string, string>);
const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('translations of the content check', () => {
  it('has the same keys in German and English, each with the same placeholders', () => {
    expect(Object.keys(deKeys).sort()).toEqual(Object.keys(enKeys).sort());
    expect(Object.keys(deKeys).length).toBeGreaterThan(60);
    for (const key of Object.keys(deKeys)) {
      expect(placeholders(deKeys[key])).toEqual(placeholders(enKeys[key]));
    }
  });

  it('has the comment key of the block in both files', () => {
    expect(
      (de as Record<string, string>)['_comment.content_check']
    ).toBeTruthy();
    expect(
      (en as Record<string, string>)['_comment.content_check']
    ).toBeTruthy();
  });

  it('has a text for every category, object type, severity and source the check can send', () => {
    for (const key of [
      ...['structure', 'quiz', 'document', 'text', 'content', 'plan'].map(
        c => `contentCheck.category.${c}`
      ),
      ...[
        'catalog',
        'course',
        'enabler',
        'useCase',
        'quiz',
        'question',
        'document',
        'learningField',
      ].map(r => `contentCheck.refType.${r}`),
      ...['error', 'warning', 'info'].flatMap(s => [
        `contentCheck.severity.${s}`,
        `contentCheck.severityOne.${s}`,
      ]),
      ...['all', 'script', 'ki', 'plan'].map(s => `contentCheck.source.${s}`),
    ]) {
      expect(deKeys[key]).toBeTruthy();
      expect(enKeys[key]).toBeTruthy();
    }
  });

  it('writes real umlauts and uses no dash as punctuation in the German texts', () => {
    const dash = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]| - `);
    for (const [key, text] of Object.entries(deKeys)) {
      expect(text).not.toMatch(dash);
      expect(text).not.toMatch(
        /\b(ae|oe|ue)\b|Pruef|Auffaellig|fuer\b|ueber\b/i
      );
      expect(key.length).toBeGreaterThan(0);
    }
    expect(deKeys['contentCheck.title']).toBe('Inhaltsprüfung');
  });
});
