// sanitizePromptData moved from src/lib/hai/prompts.ts into a shared module.
// The behaviour must stay byte for byte the same, so the test keeps a verbatim
// copy of the former implementation as the reference and compares both.
import { sanitizePromptData } from '@/lib/prompt-sanitize';

const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u061C\u180E\u200B-\u200F\u2060-\u2064\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function reference(text: string, maxLength = Infinity): string {
  return text
    .replace(INVISIBLE, '')
    .replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n')
    .split('\n')
    .map(line => line.replace(/^(\s*)#+\s*/, '$1'))
    .join('\n')
    .slice(0, maxLength);
}

const SAMPLES = [
  '',
  'plain text',
  '# Heading\r\n## Second\rthird\u2028fourth\u2029fifth\u0085sixth',
  '   ### indented heading\n\t# tab heading',
  'Kurz\u200bbegrün\u00addung\u202e Antwort\ufeff',
  'a\u0000b\u0007c\u001fd\u007fe',
  'text with # in the middle # stays',
  '#no space heading\n#\n##',
  'ümläute ÄÖÜ ß und Emoji \u{1f988}',
];

describe('sanitizePromptData', () => {
  it.each(SAMPLES)('matches the former implementation for %j', sample => {
    expect(sanitizePromptData(sample)).toBe(reference(sample));
    expect(sanitizePromptData(sample, 7)).toBe(reference(sample, 7));
  });

  it('removes invisible characters, unifies line breaks and drops heading markers', () => {
    expect(sanitizePromptData('# A\r\n## B\u200b\rC')).toBe('A\nB\nC');
  });

  it('cuts to the maximum length after cleaning', () => {
    expect(sanitizePromptData('ab\u200bcdef', 4)).toBe('abcd');
  });

  it('keeps text without anything to clean', () => {
    expect(sanitizePromptData('Hallo Welt')).toBe('Hallo Welt');
  });
});
