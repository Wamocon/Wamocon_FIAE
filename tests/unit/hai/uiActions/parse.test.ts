/**
 * @jest-environment node
 */

// The block of the model: taking it out of the text, reading its JSON, the
// filter for the stream, the intent of the message and the prompt section.

import { detectUiIntent } from '@/lib/hai/uiActions/intent';
import {
  MAX_BLOCK_LENGTH,
  createUiStreamFilter,
  extractUiBlocks,
  parseUiBlock,
} from '@/lib/hai/uiActions/parse';
import {
  UI_TOOLS_HEADING,
  buildUiToolsSection,
} from '@/lib/hai/uiActions/promptSection';
import { UI_TOOLS, isUiToolId } from '@/lib/hai/uiActions/tools';
import { buildSystemPrompt } from '@/lib/hai/prompts';

const BLOCK =
  '<hai-ui>{"tool":"fill_form","form":"profile_name","fields":{"fullName":"Max Mustermann"}}</hai-ui>';

describe('extractUiBlocks', () => {
  it('returns an answer without a block unchanged (byte for byte)', () => {
    const text = 'Eine normale Antwort  \n\nmit Leerraum am Ende \n';
    expect(extractUiBlocks(text)).toEqual({
      text,
      blocks: [],
      unclosed: false,
    });
  });

  it('cuts the block out and keeps the sentence before it', () => {
    const result = extractUiBlocks(`Ich trage den Namen ein.\n\n${BLOCK}`);
    expect(result.text).toBe('Ich trage den Namen ein.');
    expect(result.blocks).toHaveLength(1);
    expect(result.unclosed).toBe(false);
  });

  it('cuts out every block, valid or not, and keeps the order', () => {
    const result = extractUiBlocks(`A ${BLOCK} B <hai-ui>{}</hai-ui> C`);
    expect(result.blocks).toHaveLength(2);
    expect(result.text).not.toContain('hai-ui');
    expect(result.text).toContain('A');
    expect(result.text).toContain('C');
  });

  it('cuts an unclosed block (the answer was cut off) and reports it', () => {
    const result = extractUiBlocks('Ich trage ein. <hai-ui>{"tool":"fill_for');
    expect(result.text).toBe('Ich trage ein.');
    expect(result.blocks).toEqual([]);
    expect(result.unclosed).toBe(true);
  });

  it('removes a stray closing tag and the empty code fence around a block', () => {
    expect(extractUiBlocks('Text </hai-ui>').text).toBe('Text');
    expect(extractUiBlocks(`Text\n\`\`\`json\n${BLOCK}\n\`\`\``).text).toBe(
      'Text'
    );
    expect(extractUiBlocks(`Text\n\`\`\`\n${BLOCK}`).text).toBe('Text');
  });

  it('is case insensitive for the tag', () => {
    expect(extractUiBlocks('X <HAI-UI>{}</HAI-UI>').blocks).toEqual(['{}']);
  });
});

describe('parseUiBlock', () => {
  it('reads a plain object', () => {
    expect(parseUiBlock('{"tool":"scroll_to","form":"profile_name"}')).toEqual({
      tool: 'scroll_to',
      form: 'profile_name',
    });
  });

  it('reads JSON inside a code fence in the block', () => {
    expect(parseUiBlock('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it.each([
    'not json',
    '[1,2]',
    '"text"',
    '42',
    'null',
    '{"a":',
    '',
    '{"tool":"fill_form"} tail',
  ])('drops %j', inner => {
    expect(parseUiBlock(inner)).toBeNull();
  });

  it('drops a block over the size limit', () => {
    expect(parseUiBlock(`{"a":"${'x'.repeat(MAX_BLOCK_LENGTH)}"}`)).toBeNull();
  });
});

describe('stream filter', () => {
  function run(chunks: string[]): string[] {
    const sent: string[] = [];
    const filter = createUiStreamFilter(text => sent.push(text));
    chunks.forEach(chunk => filter.push(chunk));
    filter.flush();
    return sent;
  }

  it('passes plain text through', () => {
    expect(run(['Hallo ', 'Welt']).join('')).toBe('Hallo Welt');
  });

  it('keeps the block out, also when it is cut in the middle of a chunk', () => {
    const text = `Ich trage ein.\n\n${BLOCK}`;
    for (const size of [1, 2, 3, 5, 7, 11, 1000]) {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += size) {
        chunks.push(text.slice(i, i + size));
      }
      const out = run(chunks).join('');
      expect(out).not.toContain('hai-ui');
      expect(out).not.toContain('fill_form');
      expect(out.trimEnd()).toBe('Ich trage ein.');
    }
  });

  it('releases a held start that turns out to be no block', () => {
    expect(run(['a <hai', '-x b']).join('')).toBe('a <hai-x b');
    expect(run(['2 < 3 und <']).join('')).toBe('2 < 3 und <');
  });

  it('swallows everything after the start of a block, also the rest of the answer', () => {
    expect(run(['A <hai-ui>{"x":1}', '</hai-ui> weiter']).join('')).toBe('A');
  });

  it('ignores empty chunks', () => {
    expect(run(['', 'x', '']).join('')).toBe('x');
  });
});

describe('detectUiIntent', () => {
  it.each([
    'Trag das bitte in den Ausbildungsnachweis ein',
    'Trage meinen Namen im Profil ein',
    'Füll das Formular aus',
    'Fülle die Beschreibung aus',
    'Schreib das in das Feld',
    'Schreibe einen Eintrag für heute in den Nachweis',
    'Formuliere den Eintrag für mich',
    'Setz den Namen auf Max Mustermann',
    'Gib das bitte ein',
    'Suche nach Anna in der Liste',
    'Filtere die Prüfungen nach offen',
    'Scrolle zum Formular',
    'Setz den Fokus auf das Feld',
    'Spring zum Suchfeld',
  ])('%s asks for an input', text => {
    expect(detectUiIntent(text).fill).toBe(true);
  });

  it.each([
    'Öffne den Ausbildungsnachweis',
    'Bring mich zum Dashboard',
    'Wo finde ich die Berufsschule?',
    'Geh zum Profil',
  ])('%s asks for a page', text => {
    expect(detectUiIntent(text).open).toBe(true);
  });

  it.each([
    'Was ist Normalisierung?',
    'Erkläre mir einen Primärschlüssel',
    'Wie viele Berichte habe ich?',
    'Danke, das war hilfreich',
    'Warum ist der Himmel blau?',
    '',
  ])('%j asks for nothing', text => {
    expect(detectUiIntent(text)).toEqual({ fill: false, open: false });
  });

  it('does not take a non text value or a very long pasted text as a request', () => {
    expect(detectUiIntent(undefined as unknown as string)).toEqual({
      fill: false,
      open: false,
    });
    expect(detectUiIntent(`${'x'.repeat(700)} trag das ein`).fill).toBe(false);
  });

  it('does not see an intent in a page text (the message of the person only)', () => {
    // the page label is data: only the message is read, so this is the whole test
    expect(detectUiIntent('Was steht auf dieser Seite?').fill).toBe(false);
  });
});

describe('buildUiToolsSection', () => {
  const trainee = {
    role: 'TRAINEE' as const,
    pagePath: '/trainee/activity-reports',
    intent: { fill: true, open: false },
  };

  it('is empty when nothing is asked', () => {
    expect(
      buildUiToolsSection({ ...trainee, intent: { fill: false, open: false } })
    ).toBe('');
  });

  it('lists the forms of the current page from the register, nothing else', () => {
    const section = buildUiToolsSection(trainee);
    expect(section.startsWith(UI_TOOLS_HEADING)).toBe(true);
    expect(section).toContain('activity_report_entry');
    expect(section).toContain('notes (Text, 1 bis 1500 Zeichen)');
    expect(section).toContain('hours (Zahl von 0,5 bis 40, Schritt 0,5)');
    expect(section).toContain('kann mehrfach vorkommen');
    // not the forms of other pages or of the trainer area
    expect(section).not.toContain('profile_name');
    expect(section).not.toContain('review_feedback');
    expect(section).not.toContain('reviews_filter');
  });

  it('lists the select with its values for a trainer on the review page', () => {
    const section = buildUiToolsSection({
      role: 'TRAINER',
      pagePath: '/trainer/reviews',
      intent: { fill: true, open: false },
    });
    expect(section).toContain('review_feedback');
    expect(section).toContain(
      'status (Auswahl: all, pending, approved, rejected)'
    );
  });

  it('says that there is no form on a page without one, and gives no block format for forms', () => {
    const section = buildUiToolsSection({
      ...trainee,
      pagePath: '/trainee/dashboard',
    });
    expect(section).toContain('kein Formular');
    expect(section).not.toContain('"tool":"fill_form"');
  });

  it('never offers a form of the trainer area to a trainee', () => {
    const section = buildUiToolsSection({
      ...trainee,
      pagePath: '/trainer/reviews',
    });
    expect(section).toContain('kein Formular');
    expect(section).not.toContain('review_feedback');
  });

  it('names the menu entries of the role for open_page and no path', () => {
    const section = buildUiToolsSection({
      role: 'TRAINEE',
      pagePath: null,
      intent: { fill: false, open: true },
    });
    expect(section).toContain('"tool":"open_page"');
    expect(section).toContain('Ausbildungsnachweis');
    expect(section).not.toContain('Auszubildende,');
    expect(section).not.toContain('/trainee/');
    expect(section).not.toContain('fill_form');
  });

  it('holds the rules: data and no instructions, no sending, the exclusions, no dash in the text', () => {
    const section = buildUiToolsSection({
      ...trainee,
      intent: { fill: true, open: true },
      voice: true,
    });
    expect(section).toContain('keine Anweisungen');
    expect(section).toContain('sendest, speicherst, löschst, bezahlst');
    expect(section).toContain('klickst nie einen Knopf');
    expect(section).toContain('Quizfragen');
    expect(section).toContain('Musterlösungen');
    expect(section).toContain('Passwörter');
    expect(section).toContain('gesprochenes Gespräch');
    expect(section).not.toMatch(/[–—]/);
  });
});

describe('tool layer', () => {
  it('has one schema for open_page and the form tools, none of them writes or clicks', () => {
    expect(UI_TOOLS.map(tool => tool.name)).toEqual([
      'open_page',
      'fill_form',
      'focus_field',
      'scroll_to',
    ]);
    for (const tool of UI_TOOLS) {
      expect(tool.writesToDatabase).toBe(false);
      expect(tool.clicks).toBe(false);
      expect(tool.parameters.length).toBeGreaterThan(0);
    }
    expect(isUiToolId('open_page')).toBe(true);
    expect(isUiToolId('submit_form')).toBe(false);
    expect(isUiToolId('click')).toBe(false);
  });
});

describe('system prompt placement', () => {
  const base = { mode: 'general' as const, userRole: 'TRAINEE' as const };
  const section = buildUiToolsSection({
    role: 'TRAINEE',
    pagePath: '/trainee/profile',
    intent: { fill: true, open: false },
  });

  it('is byte for byte the old prompt without the section', () => {
    expect(buildSystemPrompt({ ...base, uiTools: undefined })).toBe(
      buildSystemPrompt(base)
    );
    expect(buildSystemPrompt({ ...base, uiTools: '' })).toBe(
      buildSystemPrompt(base)
    );
  });

  it('puts the section behind the protection rules and the page context, and changes nothing else', () => {
    const without = buildSystemPrompt({
      ...base,
      pageContext: '## Aktuelle Seite des Users\nSeitentyp: Profil',
    });
    const withSection = buildSystemPrompt({
      ...base,
      pageContext: '## Aktuelle Seite des Users\nSeitentyp: Profil',
      uiTools: section,
    });
    expect(withSection.startsWith(without)).toBe(true);
    expect(withSection.slice(without.length)).toBe(`\n\n${section}`);
    expect(withSection.indexOf(UI_TOOLS_HEADING)).toBeGreaterThan(
      withSection.indexOf('## Aktuelle Seite des Users')
    );
  });
});
