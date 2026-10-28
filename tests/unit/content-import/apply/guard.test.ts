import {
  findRowLeaks,
  findSolutionLeaks,
  leakOf,
  SOLUTION_MARKERS,
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

  it('finds the markers of a use case solution and the bare solution heading', () => {
    for (const text of [
      'Aufgabe\nMusterlösung',
      'Musterloesung: folgt',
      'Text\nMusterlösung\nMehr',
      'Bewertungskriterien',
      'Text\n  Bewertungskriterien:  \nMehr',
      'Lösung',
      'Text\nLoesung:\nMehr',
      'Korrekte Antwort: B',
      'Text\nAntwortschlüssel\nMehr',
      'Lösungsvorschlag: folgt',
    ]) {
      expect(leakOf(text, [])).toBe('contains a solution marker');
    }
  });

  it('does not take running text with the new words for a marker', () => {
    for (const text of [
      'Bewerten Sie die Angebote nach den Bewertungskriterien Preis und Qualität.',
      'Die Lösung des Problems liegt im Netzwerk.',
      'Eine Musterlösung hilft beim Lernen.',
      'Musterlösungen werden später gezeigt.',
      'Er suchte eine Lösung für das Problem.',
    ]) {
      expect(leakOf(text, [])).toBeNull();
    }
  });

  it('shares one exported list of markers that stays frozen', () => {
    expect(Object.isFrozen(SOLUTION_MARKERS)).toBe(true);
    expect(SOLUTION_MARKERS.length).toBeGreaterThanOrEqual(12);
    for (const marker of SOLUTION_MARKERS) {
      expect(marker).toBeInstanceOf(RegExp);
      // No global or sticky flag: the list is shared, so test() must not
      // carry a position from one call to the next.
      expect(marker.global || marker.sticky).toBe(false);
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
    expect(texts.some(t => t.startsWith('Erfundene Begründung ZETA-'))).toBe(
      true
    );
  });

  it('does not protect the solution parts of a scenario: a scenario is whole and public', () => {
    const p = plan();
    expect(p.scenarios[0].solution).toBe('Eine erfundene Lösung OMEGA.');
    const texts = solutionTexts(p);
    expect(texts).not.toContain('Eine erfundene Lösung OMEGA.');
    expect(texts).not.toContain('Ein erfundener Beitrag SIGMA.');
    // a teaching text, a component and a scenario situation may repeat them
    p.enablers[0].descriptionText = 'Dazu gehört: Eine erfundene Lösung OMEGA.';
    p.components[0].reference = 'Ein erfundener Beitrag SIGMA.';
    p.scenarios[0].situation = 'Eine erfundene Lösung OMEGA.';
    expect(findSolutionLeaks(p)).toEqual([]);
  });

  it('still protects the rationales of a quiz and the markers of a solution', () => {
    const p = plan();
    const rationale = solutionTexts(p).find(t =>
      t.startsWith('Erfundene Begründung ZETA-')
    ) as string;
    p.quizzes[0].title = `Titel ${rationale}`;
    p.enablers[0].descriptionText = 'Hinweis: Musterlösung: folgt';
    const problems = findSolutionLeaks(p).join(' ');
    expect(problems).toMatch(/quiz .* title contains a solution text/);
    expect(problems).toMatch(/enabler K1-a text contains a solution marker/);
  });

  it('names the place of a leak, never the text', () => {
    const p = plan();
    p.enablers[0].descriptionText = 'Hinweis: Kurzbegründung: folgt';
    p.components[0].reference = 'Richtige Antwort: B';
    const problems = findSolutionLeaks(p);
    expect(problems.join(' ')).toMatch(
      /enabler K1-a text contains a solution marker/
    );
    expect(problems.join(' ')).toMatch(
      /component K1 reference contains a solution marker/
    );
    expect(problems.join(' ')).not.toContain('Richtige Antwort: B');
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

  it('lets a theory document of an enabler pass and checks its title, description and file name', () => {
    const theory = {
      document_type: 'THEORY',
      visibility: 'ALL',
      enabler_id: 'e1',
      title: 'Lehrtext K1-a',
      description: 'Ein harmloser Text.',
      file_name: 'k1-a_lehrtext.pdf',
    };
    expect(findRowLeaks({ content_documents: [theory] }, solutions)).toEqual(
      []
    );
    expect(
      findRowLeaks(
        {
          content_documents: [
            { ...theory, title: 'Musterlösung: K1-a' },
            { ...theory, description: solutions[0] },
            { ...theory, file_name: 'Richtige Antwort.pdf' },
          ],
        },
        solutions
      )
    ).toEqual([
      'content_documents.title contains a solution',
      'content_documents.description contains a solution text',
      'content_documents.file_name contains a solution marker',
    ]);
  });

  it('refuses a theory document that names no enabler, names a use case, or is not visible for everyone', () => {
    const base = { document_type: 'THEORY', visibility: 'ALL', title: 't' };
    expect(
      findRowLeaks(
        {
          content_documents: [
            base,
            { ...base, enabler_id: 'e1', use_case_id: 'u1' },
            { ...base, enabler_id: 'e1', visibility: 'TRAINER_ONLY' },
          ],
        },
        []
      )
    ).toEqual([
      'content_documents THEORY row names no enabler',
      'content_documents THEORY row belongs to a use case',
      'content_documents row has an unexpected type or visibility',
    ]);
  });

  it('lets the whole scenario of an enabler pass as an exercise document for everyone', () => {
    const scenario = {
      document_type: 'EXERCISE',
      visibility: 'ALL',
      enabler_id: 'e1',
      title: 'Szenario K1-a (PDF)',
      description: null,
      file_name: '1_K1-a_szenario.pdf',
    };
    expect(findRowLeaks({ content_documents: [scenario] }, solutions)).toEqual(
      []
    );
    // title, description and file name are checked like those of a theory document
    expect(
      findRowLeaks(
        {
          content_documents: [
            { ...scenario, title: 'Musterlösung: K1-a' },
            { ...scenario, description: solutions[0] },
            { ...scenario, file_name: 'Richtige Antwort.pdf' },
          ],
        },
        solutions
      )
    ).toEqual([
      'content_documents.title contains a solution',
      'content_documents.description contains a solution text',
      'content_documents.file_name contains a solution marker',
    ]);
  });

  it('refuses an exercise document that names no enabler, names a use case, or is trainer only', () => {
    const base = { document_type: 'EXERCISE', visibility: 'ALL', title: 't' };
    expect(
      findRowLeaks(
        {
          content_documents: [
            base,
            { ...base, enabler_id: 'e1', use_case_id: 'u1' },
            { ...base, enabler_id: 'e1', visibility: 'TRAINER_ONLY' },
          ],
        },
        []
      )
    ).toEqual([
      'content_documents EXERCISE row names no enabler',
      'content_documents EXERCISE row belongs to a use case',
      'content_documents row has an unexpected type or visibility',
    ]);
  });

  it('refuses a document that is neither a trainee question nor a trainer solution, and a solution in a trainee document', () => {
    const problems = findRowLeaks(
      {
        content_documents: [
          { document_type: 'TRAINER_SOLUTION', visibility: 'ALL', title: 't' },
          { document_type: 'TRAINER_ONLY', visibility: 'ALL', title: 't' },
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

describe('the task of a scenario', () => {
  const rowOf = (description: string) => ({
    content_documents: [
      {
        document_type: 'TRAINEE_QUESTION',
        visibility: 'ALL',
        title: 'Szenario K1-a: Ausgangssituation',
        description,
        file_name: 'Szenario_1a.docx',
      },
    ],
  });

  it('is visible text: a marker or a solution text in it is a leak', () => {
    const p = plan();
    expect(findSolutionLeaks(p)).toEqual([]);
    p.scenarios[0].task = 'Eine erfundene Frage. Richtige Antwort: B';
    expect(findSolutionLeaks(p).join(' ')).toMatch(/scenario K1-a task/);
    const q = plan();
    q.scenarios[0].task = `Vorweg. ${q.scenarios[0].solution} Danach.`;
    expect(findSolutionLeaks(q).join(' ')).toMatch(
      /scenario K1-a task repeats text of a solution part/
    );
  });

  it('is a leak when it repeats one paragraph of the solution or knowledge part', () => {
    const p = plan();
    p.scenarios[0].solution =
      'Erster erfundener Absatz der Lösung.\n\nZweiter erfundener Absatz.';
    p.scenarios[0].task = 'Zweiter erfundener Absatz.';
    expect(findSolutionLeaks(p).join(' ')).toMatch(/scenario K1-a task/);
    const q = plan();
    q.scenarios[0].task = q.scenarios[0].knowledgeContribution.toUpperCase();
    expect(findSolutionLeaks(q).join(' ')).toMatch(/scenario K1-a task/);
  });

  it('is a leak when a line looks like the heading of a solution', () => {
    const p = plan();
    p.scenarios[0].task = 'Eine erfundene Frage.\n\nErwartete Lösung';
    expect(findSolutionLeaks(p).join(' ')).toMatch(
      /scenario K1-a task has a line/
    );
  });

  it('does not throw on a plan whose solution parts are missing', () => {
    const p = JSON.parse(JSON.stringify(plan()));
    delete p.scenarios[0].solution;
    p.scenarios[0].task = 'Eine erfundene Aufgabe TAU.';
    expect(() => findSolutionLeaks(p)).not.toThrow();
  });

  it('may use the word Lösung in running text', () => {
    const p = plan();
    p.scenarios[0].task = 'Entwickeln Sie eine Lösung für die erfundene Lage.';
    expect(findSolutionLeaks(p)).toEqual([]);
  });

  it('is checked in the row of the situation document that is about to be written', () => {
    const p = plan();
    const solutions = solutionTexts(p);
    expect(
      findRowLeaks(
        rowOf('Eine Lage.\n\nAufgabe\n\nEine erfundene Aufgabe.'),
        solutions
      )
    ).toEqual([]);
    expect(
      findRowLeaks(
        rowOf('Eine Lage.\n\nAufgabe\n\nRichtige Antwort: B'),
        solutions
      ).join(' ')
    ).toMatch(/content_documents\.description/);
    // the solution text of a scenario is no longer a protected text (the whole scenario is public)
    expect(
      findRowLeaks(
        rowOf(`Eine Lage.\n\nAufgabe\n\n${p.scenarios[0].solution}`),
        solutions
      )
    ).toEqual([]);
  });
});
