import {
  findUseCaseLeaks,
  findUseCaseRowLeaks,
  sharedSolutionBlocks,
  leakInUseCaseText,
  leaksInUseCase,
  solutionTextsOfUseCases,
} from '@/lib/content-import/use-cases/guard';
import { buildUseCasePlan } from '@/lib/content-import/use-cases/plan';
import type { PlanUseCase } from '@/lib/content-import/use-cases/types';

import { loadDecisions, sampleTree } from './fixtures';

const plan = () => buildUseCasePlan(sampleTree(), loadDecisions());
const first = (): PlanUseCase => ({ ...plan().useCases[0] });
const para = (...texts: string[]) => texts.join('\n\n');

describe('solutionTextsOfUseCases', () => {
  it('names the whole solution and the whole criteria of every use case', () => {
    const [a, b] = plan().useCases;
    b.criteria = 'Kriterium, das nur trainerseitig steht.';
    expect(solutionTextsOfUseCases([a, b])).toEqual([
      a.solution,
      b.solution,
      b.criteria,
    ]);
  });

  it('skips a use case without any solution text', () => {
    const uc = first();
    uc.solution = '';
    uc.criteria = null;
    expect(solutionTextsOfUseCases([uc])).toEqual([]);
  });
});

describe('sharedSolutionBlocks', () => {
  const long =
    'Ein langer erfundener Absatz der Lösung, der nur dort steht und lang genug ist.';

  it('names a solution block that stands in the visible text of another use case', () => {
    const [a, b, c] = plan().useCases;
    a.solution = para(a.solution, long);
    b.description = para(b.description, long);
    expect(sharedSolutionBlocks([a, b, c])).toEqual([
      { visibleIn: b.code, solutionOf: a.code },
    ]);
  });

  it('does not count a block that repeats the own assignment, a short block or a block nobody shows', () => {
    const [a, b] = plan().useCases;
    a.description = para(a.description, long);
    a.solution = para(a.solution, long);
    b.solution = para(b.solution, 'kurz');
    expect(sharedSolutionBlocks([a, b])).toEqual([]);
    // a long block that stands in the solution only, shown nowhere
    a.solution = para(
      a.solution,
      'Ein anderer langer erfundener Absatz, der nirgends sonst steht und lang ist.'
    );
    expect(sharedSolutionBlocks([a, b])).toEqual([]);
  });

  it('looks into the criteria as well and names a pair once', () => {
    const [a, b] = plan().useCases;
    const other =
      'Ein zweiter langer erfundener Absatz, der ebenfalls nur bei den Kriterien steht.';
    a.criteria = para(long, other);
    b.description = para(b.description, long, other);
    expect(sharedSolutionBlocks([a, b])).toEqual([
      { visibleIn: b.code, solutionOf: a.code },
    ]);
  });
});

describe('leakInUseCaseText', () => {
  it('finds a marker, a solution text, and nothing in a clean text', () => {
    const solutions = ['Die erfundene Lösung nennt zwölf Schrauben genau.'];
    expect(leakInUseCaseText(null, solutions)).toBeNull();
    expect(leakInUseCaseText('', solutions)).toBeNull();
    expect(leakInUseCaseText('Ein sauberer Text.', solutions)).toBeNull();
    expect(leakInUseCaseText('Siehe Musterlösung.', solutions)).toMatch(
      /marker/
    );
    expect(
      leakInUseCaseText(
        'Vorne. Die erfundene Lösung nennt zwölf Schrauben genau. Hinten.',
        solutions
      )
    ).toMatch(/solution text/);
  });

  it('the word Bewertungskriterien is no marker, tasks use it', () => {
    expect(
      leakInUseCaseText('Die sieben Bewertungskriterien gelten für alle.', [])
    ).toBeNull();
  });
});

describe('findUseCaseLeaks and leaksInUseCase', () => {
  it('finds nothing in a clean plan', () => {
    expect(findUseCaseLeaks(plan())).toEqual([]);
  });

  it.each(['title', 'description', 'topics'] as const)(
    'finds a marker in the %s',
    field => {
      const p = plan();
      (p.useCases[0] as any)[field] = 'Mit Musterlösung hier';
      expect(findUseCaseLeaks(p).join(' ')).toContain(
        `use case ${p.useCases[0].code} ${field}`
      );
    }
  );

  it('finds the whole solution of another use case in a visible field', () => {
    const p = plan();
    p.useCases[1].solution =
      'Die lange erfundene Antwort KAPPA lautet zwölf Schrauben.';
    p.useCases[0].topics = p.useCases[1].solution;
    expect(
      leaksInUseCase(p.useCases[0], solutionTextsOfUseCases(p.useCases))
    ).toHaveLength(1);
  });
});

describe('findUseCaseRowLeaks', () => {
  const doc = (patch: Record<string, unknown> = {}) => ({
    use_case_id: 'uc',
    title: 'Use Case K1-a: Behandelte Themen',
    description: 'Erfundene Themen.',
    file_name: 'UC_1a_Titel.docx',
    document_type: 'THEORY',
    visibility: 'ALL',
    ...patch,
  });
  const check = (
    rows: { use_cases?: any[]; content_documents?: any[] },
    solutions: string[] = []
  ) =>
    findUseCaseRowLeaks(
      {
        use_cases: rows.use_cases ?? [],
        content_documents: rows.content_documents ?? [],
      },
      solutions
    );

  it('accepts a topics row and a trainer-only solution row', () => {
    expect(
      check({
        use_cases: [{ title: 'Titel', description_text: 'Text' }],
        content_documents: [
          doc(),
          doc({
            title: 'Use Case K1-a: Musterlösung (Trainer)',
            description: 'Die Lösung OMEGA.',
            document_type: 'TRAINER_SOLUTION',
            visibility: 'TRAINER_ONLY',
          }),
        ],
      })
    ).toEqual([]);
  });

  it('refuses a marker in a use case, a solution in a topics row, an odd type and a row without use case', () => {
    expect(
      check({ use_cases: [{ title: 'Musterlösung', description_text: 'x' }] })
    ).toEqual(['use_cases.title contains a solution marker']);
    expect(
      check({
        use_cases: [{ title: 1, description_text: 'Fachwissen zur Lösung' }],
      })
    ).toEqual(['use_cases.description_text contains a solution marker']);
    expect(
      check({ content_documents: [doc({ description: 'Musterlösung' })] })
    ).toEqual(['content_documents.description contains a solution marker']);
    expect(
      check({
        content_documents: [doc({ title: 5, file_name: 'Musterlösung.docx' })],
      })
    ).toEqual(['content_documents.file_name contains a solution marker']);
    expect(
      check({ content_documents: [doc({ visibility: 'TRAINER_ONLY' })] })
    ).toEqual(['content_documents row has an unexpected type or visibility']);
    expect(
      check({
        content_documents: [
          doc({ document_type: 'TRAINER_SOLUTION', visibility: 'ALL' }),
        ],
      })
    ).toEqual(['content_documents row has an unexpected type or visibility']);
    expect(check({ content_documents: [doc({ use_case_id: null })] })).toEqual([
      'content_documents row names no use case',
    ]);
  });
});
