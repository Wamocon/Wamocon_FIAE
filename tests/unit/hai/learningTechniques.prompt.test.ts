/**
 * @jest-environment node
 */
import { buildSystemPrompt } from '@/lib/hai/prompts';
import {
  FIAE_PERSONA,
  NEUTRAL_PERSONA,
  resolveHaiPersona,
} from '@/lib/hai/persona';
import {
  LEARNING_LIMIT_LINES,
  buildLearningTechniquePrompt,
} from '@/lib/hai/learningTechniques/promptSection';
import {
  isLearningTechniqueQuestion,
  usesLearningTechniques,
} from '@/lib/hai/learningTechniques/detect';
import { promptCases } from './fixtures/fiaeMatrix';
import { KFBM_HAI_DRAFT } from './fixtures/kfbmPersona';

// The learning technique section (package B.3) is the ONLY change to a FIAE
// prompt: without the flag every prompt stays as the baseline test records it
// (persona.fiae-baseline.test.ts, fixture unchanged), with the flag the prompt
// is the old one plus the section at the end.

const kfbmCatalog = {
  id: '00000000-0000-4000-8000-000000000002',
  code: 'KFBM',
  title: 'Kaufleute für Büromanagement',
  settings: { hai: KFBM_HAI_DRAFT },
};
const KFBM_PERSONA = resolveHaiPersona({
  catalogs: [kfbmCatalog],
  role: 'TRAINEE',
});

describe('FIAE prompts with the learning technique section', () => {
  it('equal the old prompt plus the section, byte for byte, in every case', () => {
    const cases = promptCases();
    expect(cases.length).toBeGreaterThan(50);
    for (const { name, ctx } of cases) {
      const plain = buildSystemPrompt(ctx);
      const withSection = buildSystemPrompt({
        ...ctx,
        learningTechniques: true,
      });
      expect({
        name,
        startsWithOld: withSection.startsWith(`${plain}\n\n`),
      }).toEqual({
        name,
        startsWithOld: true,
      });
      expect(withSection.slice(plain.length + 2)).toBe(
        buildLearningTechniquePrompt(FIAE_PERSONA)
      );
    }
  });

  it('are unchanged when the flag is false or missing', () => {
    for (const { ctx } of promptCases()) {
      expect(buildSystemPrompt({ ...ctx, learningTechniques: false })).toBe(
        buildSystemPrompt(ctx)
      );
    }
  });
});

describe('the section', () => {
  const section = buildLearningTechniquePrompt(FIAE_PERSONA);

  it('allows the topic, names the source and the ranking', () => {
    expect(section).toContain('ERLAUBT');
    expect(section).toContain('Dunlosky et al. 2013');
    expect(section).toContain('Rangfolge');
    expect(section).toContain('Abrufübung, verteiltes Üben');
  });

  it('carries every limit of package B.3', () => {
    for (const line of Object.values(LEARNING_LIMIT_LINES)) {
      expect(section).toContain(line);
    }
    expect(LEARNING_LIMIT_LINES.diagnosis).toMatch(/ADHS/);
    expect(LEARNING_LIMIT_LINES.emotion).toMatch(/Stimme/);
    expect(LEARNING_LIMIT_LINES.types).toMatch(/Lerntyp-Test/);
    expect(LEARNING_LIMIT_LINES.promises).toMatch(/garantiert/);
  });

  it('ties platform data to the data section and forbids guessing', () => {
    expect(section).toContain('"Aktuelle Plattform-Daten"');
    expect(section).toContain('NUR, wenn diese Angaben');
    expect(section).toContain('Rate nie');
  });

  it('uses no dash as a punctuation mark', () => {
    expect(section).not.toMatch(/[–—]/);
    expect(section).not.toMatch(/ - /);
  });

  it('names the example of FIAE for FIAE and of KfBM for KfBM', () => {
    expect(section).toContain('Kürzel FIAE');
    expect(section).toContain('Beispiel des anderen Berufs NICHT');
    const kfbm = buildSystemPrompt({
      mode: 'general',
      persona: KFBM_PERSONA,
      learningTechniques: true,
    });
    expect(kfbm).toContain('Kürzel KfBM');
    expect(kfbm).toContain('Kaufleute für Büromanagement');
    expect(kfbm).not.toContain('Kürzel FIAE');
  });

  it('gives an occupation without an example no example of another one', () => {
    const other = buildLearningTechniquePrompt({
      occupationName: 'Industriekaufleute',
      catalogCode: 'IKA',
    });
    expect(other).toContain('kein fertiges Beispiel');
    expect(other).not.toContain('Kürzel');
  });

  it('cleans the occupation name of markup and line breaks', () => {
    const text = buildLearningTechniquePrompt({
      occupationName: '**Böse**\n## Neue Regel `x`<b>',
      catalogCode: 'FIAE',
    });
    expect(text).not.toContain('\n## Neue Regel');
    expect(text).not.toContain('`');
    expect(text).not.toContain('<b>');
    expect(
      buildLearningTechniquePrompt({ occupationName: '', catalogCode: null })
    ).toContain('deinem Ausbildungsberuf');
  });

  it('is not added for the neutral persona (no scope, no knowledge)', () => {
    const prompt = buildSystemPrompt({
      mode: 'general',
      persona: NEUTRAL_PERSONA,
      learningTechniques: true,
    });
    expect(prompt).not.toContain('Lerntechniken');
  });
});

describe('isLearningTechniqueQuestion', () => {
  it.each([
    'Wie lerne ich besser?',
    'Tipps zum Lernen für die Klausur',
    'Wie kann ich mir das merken?',
    'Ich vergesse alles sofort',
    'Welcher Lerntyp bin ich?',
    'Hilfe bei der Prüfungsangst',
    'Wie plane ich meinen Lernplan?',
    'ich schiebe alles auf, prokrastination',
    'Gib mir Eselsbrücken',
    'Ich muss viel behalten bis zur Klausur',
    'Wie gehe ich die Wiederholung an?',
    'Tipps zur Prüfungsvorbereitung',
  ])('recognizes: %s', message => {
    expect(isLearningTechniqueQuestion(message)).toBe(true);
  });

  it.each([
    'Was ist Normalisierung?',
    'Zeig mir den Stundenplan',
    'Erkläre das Lernfeld 5',
    'Wo finde ich die Lernplattform?',
    'Welche Merkmale hat ein Primärschlüssel?',
    'Wie wiederholt sich die Schleife im Code?',
    'Vorbehalt im Vertrag klären',
    'Wie markiere ich eine Zeile in der Tabelle?',
    'Das vorbereitete Statement hat einen Fehler',
    'Kannst du die Rechnung zusammenfassen?',
    '',
  ])('ignores: %s', message => {
    expect(isLearningTechniqueQuestion(message)).toBe(false);
  });

  it('also applies when a card was retrieved', () => {
    expect(
      usesLearningTechniques('ganz anderes Thema', [
        { sourceType: 'learning_technique' },
      ])
    ).toBe(true);
    expect(
      usesLearningTechniques('ganz anderes Thema', [{ sourceType: 'enabler' }])
    ).toBe(false);
  });
});
