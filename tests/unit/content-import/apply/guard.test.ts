import {
  findRowLeaks,
  findSolutionLeaks,
  leakOf,
  solutionTexts,
} from '@/lib/content-import/apply/guard';
import { buildImportPlan } from '@/lib/content-import/apply/plan';

import { loadDecisions, sampleTree } from './fixtures';

const plan = () =>
  buildImportPlan(sampleTree(), loadDecisions(), {
    now: new Date('2026-10-26T12:00:00Z'),
  });

describe('leakOf', () => {
  const solutions = ['Eine sehr ausführliche erfundene Begründung ohne Ende.'];

  it('finds the marker words of a solution in any spelling', () => {
    for (const text of [
      'Richtige Antwort: B',
      'Frage?\nRichtige  Antwort B',
      'Kurzbegründung: folgt',
      'Kurzbegruendung folgt',
      'Lösungsszenario',
      'Loesungszenario',
      'Fachwissen zur Lösung',
    ]) {
      expect(leakOf(text, [])).toBe('contains a solution marker');
    }
  });

  it('finds a long solution text inside another text, whatever the white space', () => {
    expect(
      leakOf(
        'Vorspann. Eine  sehr ausführliche erfundene\nBegründung ohne Ende. Nachspann',
        solutions
      )
    ).toBe('contains a solution text');
  });

  it('compares without regard to upper and lower case', () => {
    expect(
      leakOf(
        'EINE SEHR AUSFÜHRLICHE ERFUNDENE BEGRÜNDUNG OHNE ENDE.',
        solutions
      )
    ).toBe('contains a solution text');
  });

  it('does not take the plain words in running text for a marker', () => {
    expect(
      leakOf('Welche ist die richtige Antwort auf die Anfrage?', [])
    ).toBeNull();
    expect(leakOf('Eine Kurzbegründung des Kunden liegt vor.', [])).toBeNull();
  });

  it('lets harmless text and short solution texts pass', () => {
    expect(leakOf('Welche Aussage ist richtig?', solutions)).toBeNull();
    expect(leakOf('Ja', ['Ja'])).toBeNull();
    expect(leakOf('', solutions)).toBeNull();
  });
});

describe('findSolutionLeaks', () => {
  it('is quiet for a plan from the planner and collects the solution texts', () => {
    const p = plan();
    expect(findSolutionLeaks(p)).toEqual([]);
    const texts = solutionTexts(p);
    expect(texts).toContain('Eine erfundene Lösung OMEGA.');
    expect(texts).toContain('Ein erfundener Beitrag SIGMA.');
    expect(texts.some(t => t.startsWith('Erfundene Begründung ZETA-'))).toBe(
      true
    );
  });

  it('names the place of a leak, never the text', () => {
    const p = plan();
    p.enablers[0].descriptionText = 'Hinweis: Kurzbegründung: folgt';
    p.components[0].reference = 'Eine erfundene Lösung OMEGA.';
    const problems = findSolutionLeaks(p);
    expect(problems.join(' ')).toMatch(
      /enabler K1-a text contains a solution marker/
    );
    expect(problems.join(' ')).toMatch(
      /component K1 reference contains a solution text/
    );
    expect(problems.join(' ')).not.toContain('OMEGA');
  });
});

describe('findRowLeaks', () => {
  const solutions = ['Eine erfundene Lösung OMEGA, lang genug fuer die Suche.'];

  it('accepts the places the app keeps solutions in', () => {
    expect(
      findRowLeaks(
        {
          options: [
            { option_text: 'a', is_correct: true, explanation: 'Grund' },
            { option_text: 'b', is_correct: false, explanation: null },
          ],
          questions: [{ question_text: 'Frage?', expected_answer: null }],
          content_documents: [
            {
              document_type: 'TRAINEE_QUESTION',
              visibility: 'ALL',
              title: 'Szenario K1-a: Ausgangssituation',
              description: 'Eine Lage.',
            },
            {
              document_type: 'TRAINER_SOLUTION',
              visibility: 'TRAINER_ONLY',
              title: 'Szenario K1-a: Lösung (Trainer)',
              description: solutions[0],
            },
          ],
        },
        solutions
      )
    ).toEqual([]);
  });

  it('refuses a solution in a visible column', () => {
    const problems = findRowLeaks(
      {
        questions: [{ question_text: `Frage ${solutions[0]}` }],
        options: [{ option_text: 'Richtige Antwort', is_correct: false }],
        enablers: [{ title: 'x', description_text: solutions[0] }],
      },
      solutions
    );
    expect([...problems].sort()).toEqual([
      'enablers.description_text contains a solution text',
      'options.option_text contains a solution marker',
      'questions.question_text contains a solution text',
    ]);
  });

  it('refuses an explanation on a wrong option and an expected answer', () => {
    const problems = findRowLeaks(
      {
        options: [
          { option_text: 'a', is_correct: false, explanation: 'Grund' },
        ],
        questions: [{ question_text: 'f', expected_answer: 'B' }],
      },
      []
    );
    expect(problems).toEqual([
      'options.explanation is set on an option that is not correct',
      'questions.expected_answer must stay empty',
    ]);
  });

  it('refuses a document that is neither a trainee question nor a trainer solution, and a solution in a trainee document', () => {
    const problems = findRowLeaks(
      {
        content_documents: [
          { document_type: 'TRAINER_SOLUTION', visibility: 'ALL', title: 't' },
          { document_type: 'THEORY', visibility: 'ALL', title: 't' },
          {
            document_type: 'TRAINEE_QUESTION',
            visibility: 'ALL',
            title: 't',
            description: solutions[0],
          },
          {
            document_type: 'TRAINER_SOLUTION',
            visibility: 'TRAINER_ONLY',
            title: 'Lösungsszenario',
          },
        ],
      },
      solutions
    );
    expect(problems).toEqual([
      'content_documents row has an unexpected type or visibility',
      'content_documents row has an unexpected type or visibility',
      'content_documents.description contains a solution text',
      'content_documents.title contains a solution',
    ]);
  });
});
