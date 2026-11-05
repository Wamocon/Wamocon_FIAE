import { catalogDisplayTitle } from '@/lib/catalog/display-title';
import deStrings from '@/locales/de.json';
import enStrings from '@/locales/en.json';

const lookup = (strings: Record<string, string>) => (key: string) =>
  strings[key] ?? key;
const de = lookup(deStrings as Record<string, string>);
const en = lookup(enStrings as Record<string, string>);

describe('catalogDisplayTitle (KFB-1183)', () => {
  it('names FIAE and KfBM in English from the translations', () => {
    expect(catalogDisplayTitle(en, 'FIAE', 'Fachinformatiker/in')).toBe(
      'IT Specialist for Application Development'
    );
    expect(
      catalogDisplayTitle(en, 'KFBM', 'Kaufmann/-frau für Büromanagement')
    ).toBe('Office Management Clerk');
  });

  it('keeps the title of the database in German', () => {
    expect(
      catalogDisplayTitle(de, 'KFBM', 'Kaufmann/-frau für Büromanagement')
    ).toBe('Kaufmann/-frau für Büromanagement');
  });

  it('falls back to the title for a code without translation', () => {
    expect(catalogDisplayTitle(en, 'ELEK', 'Elektroniker/in')).toBe(
      'Elektroniker/in'
    );
  });

  it('matches the code case-insensitively and survives missing values', () => {
    expect(catalogDisplayTitle(en, ' kfbm ', 'x')).toBe(
      'Office Management Clerk'
    );
    expect(catalogDisplayTitle(en, null, 'Titel')).toBe('Titel');
    expect(catalogDisplayTitle(en, 'ELEK', null)).toBe('ELEK');
  });
});
