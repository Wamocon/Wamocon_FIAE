/**
 * @jest-environment node
 */
import path from 'path';

// Check questions of package B.3 as an offline fixture. No model is called: the
// test proves what the code can prove (the section with its limits reaches the
// prompt of the right occupation, the cards behind a tip exist and carry an
// example for the occupation, the data intent of the message) and that the limit
// check (lintLearningAnswer) accepts the good and flags the bad sample answers.
// What the live model answers is checked by hand with the same list (see
// docs/hai-lerntechniken.md).

jest.mock('@/db', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/auth-helpers', () => ({ toHaiRole: jest.fn() }));
jest.mock('@/lib/catalog/scope', () => ({
  getCatalogScopeForUserId: jest.fn(),
}));
jest.mock('@/lib/catalog/phase-plan-db', () => ({ loadPhasePlan: jest.fn() }));

import { classifyDataIntent } from '@/lib/hai/dataContext';
import { lintLearningAnswer } from '@/lib/hai/learningTechniques/answerLint';
import { isLearningTechniqueQuestion } from '@/lib/hai/learningTechniques/detect';
import {
  LEARNING_TECHNIQUES_DIR,
  loadLearningTechniqueCards,
} from '@/lib/hai/learningTechniques/loader';
import { LEARNING_LIMIT_LINES } from '@/lib/hai/learningTechniques/promptSection';
import { resolveHaiPersona } from '@/lib/hai/persona';
import { buildSystemPrompt } from '@/lib/hai/prompts';
import {
  LEARNING_CHECK_CASES,
  type CheckGroup,
} from './fixtures/learningTechniqueChecks';
import { KFBM_HAI_DRAFT } from './fixtures/kfbmPersona';

const cards = loadLearningTechniqueCards(
  path.join(process.cwd(), LEARNING_TECHNIQUES_DIR)
);
const cardById = new Map(cards.map(c => [c.id, c]));

const FIAE_CATALOG = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'FIAE',
  title: 'Fachinformatiker Anwendungsentwicklung',
  settings: {},
};
const KFBM_CATALOG = {
  id: '00000000-0000-4000-8000-000000000002',
  code: 'KFBM',
  title: 'Kaufleute für Büromanagement',
  settings: { hai: KFBM_HAI_DRAFT },
};

function personaOf(occupation: 'FIAE' | 'KFBM', role: 'TRAINEE' | 'TRAINER') {
  return resolveHaiPersona({
    catalogs: [occupation === 'FIAE' ? FIAE_CATALOG : KFBM_CATALOG],
    role,
  });
}

const LIMIT_LINE_OF_GROUP: Partial<Record<CheckGroup, string>> = {
  'limit-lerntyp': LEARNING_LIMIT_LINES.types,
  'limit-diagnose': LEARNING_LIMIT_LINES.diagnosis,
  'limit-emotion': LEARNING_LIMIT_LINES.emotion,
  'limit-versprechen': LEARNING_LIMIT_LINES.promises,
};

describe('the list of check questions', () => {
  it('has at least 20 cases with unique ids', () => {
    expect(LEARNING_CHECK_CASES.length).toBeGreaterThanOrEqual(20);
    const ids = LEARNING_CHECK_CASES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the three limits, the tip on a card, the example and the data', () => {
    const groups = new Set(LEARNING_CHECK_CASES.map(c => c.group));
    expect([...groups].sort()).toEqual([
      'beruf-beispiel',
      'daten',
      'limit-diagnose',
      'limit-emotion',
      'limit-lerntyp',
      'limit-versprechen',
      'tip-karte',
    ]);
  });

  it('covers FIAE and KfBM, trainee and trainer', () => {
    const occupations = new Set(LEARNING_CHECK_CASES.map(c => c.occupation));
    const roles = new Set(LEARNING_CHECK_CASES.map(c => c.role));
    expect([...occupations].sort()).toEqual(['FIAE', 'KFBM']);
    expect([...roles].sort()).toEqual(['TRAINEE', 'TRAINER']);
  });
});

describe.each(LEARNING_CHECK_CASES)('check $id', testCase => {
  const persona = personaOf(testCase.occupation, testCase.role);

  it('is recognized as a question about learning', () => {
    expect(isLearningTechniqueQuestion(testCase.message)).toBe(true);
  });

  it('gets the limits and the example rule of the occupation in the prompt', () => {
    const prompt = buildSystemPrompt({
      mode: 'general',
      persona,
      learningTechniques: true,
      userRole: testCase.role,
    });
    for (const line of Object.values(LEARNING_LIMIT_LINES)) {
      expect(prompt).toContain(line);
    }
    const limit = LIMIT_LINE_OF_GROUP[testCase.group];
    if (limit) expect(prompt).toContain(limit);
    expect(prompt).toContain(
      testCase.occupation === 'FIAE' ? 'Kürzel FIAE' : 'Kürzel KfBM'
    );
  });

  it('keeps the good sample answer inside the limits and the occupation', () => {
    expect(
      lintLearningAnswer(testCase.goodAnswer, testCase.occupation)
    ).toEqual([]);
  });

  if (testCase.badAnswer && testCase.violation) {
    it('flags the bad sample answer', () => {
      expect(
        lintLearningAnswer(testCase.badAnswer!, testCase.occupation)
      ).toContain(testCase.violation);
    });
  }

  if (testCase.cards) {
    it('rests on cards that exist and carry an example for the occupation', () => {
      for (const id of testCase.cards!) {
        const card = cardById.get(id);
        expect(card).toBeDefined();
        expect(card!.examples[testCase.occupation].length).toBeGreaterThan(20);
      }
      // the answer names the technique of (one of) the cards
      const mention = testCase.mentions!.toLowerCase();
      const referenced = testCase.cards!.map(id => cardById.get(id)!);
      expect(
        referenced.some(c => c.title.toLowerCase().includes(mention))
      ).toBe(true);
      expect(testCase.goodAnswer.toLowerCase()).toContain(mention);
    });
  }

  if (testCase.group === 'beruf-beispiel') {
    it('uses the example of the card for this occupation', () => {
      const card = cardById.get(testCase.cards![0])!;
      const example = card.examples[testCase.occupation];
      expect(testCase.goodAnswer).toContain(example.slice(0, 40));
      const other = testCase.occupation === 'FIAE' ? 'KFBM' : 'FIAE';
      expect(testCase.goodAnswer).not.toContain(
        card.examples[other].slice(0, 40)
      );
    });
  }

  if (testCase.dataIntent !== undefined) {
    it('gets the data intent that links the tip to the platform data', () => {
      expect(classifyDataIntent(testCase.message, testCase.role)).toBe(
        testCase.dataIntent
      );
    });
  }
});

describe('the limit check', () => {
  it('lets a neutral, correct explanation of learning types pass', () => {
    expect(
      lintLearningAnswer(
        'Lerntypen sind nicht belastbar belegt, deshalb teile ich dich nicht ein.',
        'FIAE'
      )
    ).toEqual([]);
  });

  it('reports several violations at once', () => {
    expect(
      lintLearningAnswer(
        'Du hast eine Lernschwäche und bestehst garantiert nicht ohne Hilfe.',
        null
      ).sort()
    ).toEqual(['diagnose', 'heilversprechen']);
  });

  it('does not check the occupation without one', () => {
    expect(
      lintLearningAnswer('Schreibe eine SQL Abfrage und eine Rechnung.', null)
    ).toEqual([]);
  });
});
