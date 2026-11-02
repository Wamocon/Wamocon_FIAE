import {
  documentTypeLabel,
  documentTypeLabelKey,
} from '@/lib/documentTypeLabel';
import de from '@/locales/de.json';
import en from '@/locales/en.json';

// The task and the model solution of a use case are two PDFs with nearly the same
// title. The content editor showed the letter S for both, so a trainer took them for
// an old and a new copy. They need different names on the screen.

const TYPES = [
  'THEORY',
  'EXERCISE',
  'TRAINEE_QUESTION',
  'TRAINER_SOLUTION',
] as const;

describe('documentTypeLabel', () => {
  it('gives every type its own label key', () => {
    const keys = TYPES.map(type => documentTypeLabelKey(type));
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(TYPES.length);
  });

  it('names task and model solution differently (the case of the use case 24B)', () => {
    const t = (key: string) => (de as Record<string, string>)[key];
    expect(documentTypeLabel('TRAINEE_QUESTION', t)).toBe('Aufgabe');
    expect(documentTypeLabel('TRAINER_SOLUTION', t)).toBe('Musterlösung');
  });

  it('has a text in German and English for every label key', () => {
    for (const type of TYPES) {
      const key = documentTypeLabelKey(type)!;
      expect((de as Record<string, string>)[key]).toBeTruthy();
      expect((en as Record<string, string>)[key]).toBeTruthy();
    }
  });

  it('falls back to the raw type, or to an empty text, for an unknown type', () => {
    const t = (key: string) => key;
    expect(documentTypeLabel('SOMETHING_NEW', t)).toBe('SOMETHING_NEW');
    expect(documentTypeLabel(undefined, t)).toBe('');
    expect(documentTypeLabelKey(null)).toBeNull();
  });
});
