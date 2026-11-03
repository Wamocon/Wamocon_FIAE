import {
  MAX_REFS,
  enablerHasScenario,
  runScriptRules,
  scenarioPartNumbers,
} from '@/lib/catalog/content-check/script-checks';
import type { ContentSnapshot } from '@/lib/catalog/content-check/snapshot';
import type { Finding } from '@/lib/catalog/content-check/types';
import {
  CATALOG,
  OTHER_CATALOG,
  cleanSnapshot,
  doc,
  enabler,
  quizzesOf,
  questionsOf,
  makeUseCase,
} from './fixtures';

/** The findings of one rule (an empty list when it did not fire). */
const rule = (findings: Finding[], id: string): Finding[] =>
  findings.filter(f => f.rule === id);

function check(mutate: (s: ContentSnapshot) => void): Finding[] {
  const snap = cleanSnapshot();
  mutate(snap);
  return runScriptRules(snap);
}

/** An enabler with its own quizzes, questions and use case, so it adds no finding. */
function addCompleteEnabler(
  s: ContentSnapshot,
  n: number,
  over: Parameters<typeof enabler>[1] = {}
) {
  const e = enabler(n, { id: `x${n}`, title: `Zusatz ${n}`, ...over });
  s.enablers.push(e);
  const quizzes = quizzesOf(e.id);
  s.quizzes.push(...quizzes);
  s.questions.push(...quizzes.flatMap(z => questionsOf(z.id)));
  s.useCases.push(
    makeUseCase(n, { id: `ux${n}`, enablerId: e.id, title: `Aufgabe ${n}` })
  );
  s.documents.push(
    doc(`th-${e.id}`, { enablerId: e.id, type: 'THEORY' }),
    doc(`sc-${e.id}`, { enablerId: e.id, type: 'EXERCISE' }),
    doc(`ta-${e.id}`, { useCaseId: `ux${n}`, type: 'TRAINEE_QUESTION' }),
    doc(`lo-${e.id}`, { useCaseId: `ux${n}`, type: 'TRAINER_SOLUTION' })
  );
  s.mappings.push(
    { learningFieldId: 'lf1', enablerId: e.id, useCaseId: null },
    { learningFieldId: 'lf1', enablerId: null, useCaseId: `ux${n}` }
  );
  return e;
}

describe('script checks: the clean data set', () => {
  it('has no finding at all', () => {
    expect(runScriptRules(cleanSnapshot())).toEqual([]);
  });

  it('every finding has the promised shape', () => {
    const findings = check(s => {
      s.enablers[0].title = 'gestaltenInhaltsverzeichnis';
      s.quizzes = s.quizzes.filter(z => z.enablerId !== 'en2');
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.source).toBe('script');
      expect(['error', 'warning', 'info']).toContain(f.severity);
      expect(f.summary.length).toBeGreaterThan(0);
      expect(f.refs.length).toBeGreaterThan(0);
      expect(f.refs.length).toBeLessThanOrEqual(MAX_REFS);
      for (const r of f.refs) {
        expect(r.id).toBeTruthy();
        expect(r.label).toBeTruthy();
      }
    }
  });
});

describe('structure', () => {
  it('course without an enabler', () => {
    const f = check(s => {
      s.courses.push({
        id: 'c2',
        code: 'K2',
        title: 'Leere Komponente',
        description: null,
        trainingComponentId: null,
        isActive: true,
      });
    });
    const hit = rule(f, 'course.enabler.missing');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'error', category: 'structure' });
    expect(hit[0].refs).toEqual([
      { type: 'course', id: 'c2', label: 'K2: Leere Komponente' },
    ]);
  });

  it('enabler without a course and enabler of another catalog than its course', () => {
    const f = check(s => {
      addCompleteEnabler(s, 3, { courseCatalogId: null });
      addCompleteEnabler(s, 4, { courseCatalogId: OTHER_CATALOG });
    });
    expect(rule(f, 'enabler.course.missing')[0].refs[0].id).toBe('x3');
    expect(rule(f, 'enabler.catalog.mismatch')[0].refs[0].id).toBe('x4');
    expect(rule(f, 'enabler.catalog.mismatch')[0].severity).toBe('error');
  });

  it('quiz and use case of another catalog than their enabler', () => {
    const f = check(s => {
      s.quizzes[0].enablerCatalogId = OTHER_CATALOG;
      s.useCases[0].catalogId = OTHER_CATALOG;
    });
    expect(rule(f, 'quiz.catalog.mismatch')).toHaveLength(1);
    expect(rule(f, 'usecase.catalog.mismatch')).toHaveLength(1);
  });

  it('phase plan component without a course, only where courses are linked', () => {
    const component = (id: string, title: string) => ({
      id,
      code: id.toUpperCase(),
      title,
      totalWeeks: 4,
      totalHours: 160,
      phase: 1,
      kind: 'pflicht',
    });
    const none = check(s => {
      s.components.push(component('t1', 'Komponente'));
    });
    expect(rule(none, 'component.course.missing')).toEqual([]);
    const linked = check(s => {
      s.courses[0].trainingComponentId = 't1';
      s.components.push(
        component('t1', 'Komponente'),
        component('t2', 'Ohne Kurs')
      );
    });
    expect(rule(linked, 'component.course.missing')[0].refs).toEqual([
      { type: 'catalog', id: 't2', label: 'T2: Ohne Kurs' },
    ]);
  });

  describe('links of enablers and use cases', () => {
    /** Ten enablers, each with a use case (KfBM like: 1:1). */
    const oneToOne = (s: ContentSnapshot) => {
      for (let n = 3; n <= 10; n += 1) addCompleteEnabler(s, n);
    };
    /** Ten enablers with ten use cases, the use cases linked to no enabler. */
    const unlink = (s: ContentSnapshot, count: number) => {
      s.useCases.slice(0, count).forEach(u => {
        u.enablerId = null;
      });
    };

    it('KfBM like (1:1): one gap is a warning with the object named', () => {
      const f = check(s => {
        oneToOne(s);
        unlink(s, 1);
      });
      const noUseCase = rule(f, 'enabler.usecase.missing');
      const noEnabler = rule(f, 'usecase.enabler.missing');
      expect(noUseCase).toHaveLength(1);
      expect(noUseCase[0]).toMatchObject({ severity: 'warning' });
      expect(noUseCase[0].refs).toHaveLength(1);
      expect(noEnabler[0]).toMatchObject({ severity: 'warning' });
      expect(noEnabler[0].refs).toHaveLength(1);
    });

    it('exactly 80 percent still counts as the 1:1 relation', () => {
      const f = check(s => {
        oneToOne(s);
        unlink(s, 2);
      });
      expect(rule(f, 'enabler.usecase.missing')[0].severity).toBe('warning');
      expect(rule(f, 'usecase.enabler.missing')[0].severity).toBe('warning');
    });

    it('FIAE like before the linking: one note with the numbers, no list', () => {
      const f = check(s => {
        oneToOne(s);
        unlink(s, 10);
      });
      const noUseCase = rule(f, 'enabler.usecase.missing');
      const noEnabler = rule(f, 'usecase.enabler.missing');
      expect(noUseCase).toHaveLength(1);
      expect(noUseCase[0]).toMatchObject({ severity: 'info', refs: [] });
      expect(noUseCase[0].summary).toBe(
        'In dieser Ausbildung hat nicht jeder Enabler einen Use Case (0 von 10).'
      );
      expect(noEnabler).toHaveLength(1);
      expect(noEnabler[0]).toMatchObject({ severity: 'info', refs: [] });
      expect(noEnabler[0].summary).toContain('(0 von 10)');
    });

    it('FIAE like after the linking: the alarm per use case is gone, the note about the enablers stays', () => {
      // 10 enablers, only 4 of them have a use case, every use case is linked
      const f = check(s => {
        oneToOne(s);
        s.useCases = s.useCases.slice(0, 4);
      });
      expect(rule(f, 'usecase.enabler.missing')).toEqual([]);
      const noUseCase = rule(f, 'enabler.usecase.missing');
      expect(noUseCase).toHaveLength(1);
      expect(noUseCase[0]).toMatchObject({ severity: 'info', refs: [] });
      expect(noUseCase[0].summary).toContain('(4 von 10)');
    });

    it('a mostly linked catalog without the 1:1 relation of every enabler stays a warning', () => {
      // 9 of 10 enablers have a use case: the rest is an irregularity
      const f = check(s => {
        oneToOne(s);
        s.useCases = s.useCases.slice(0, 9);
      });
      const noUseCase = rule(f, 'enabler.usecase.missing');
      expect(noUseCase[0].severity).toBe('warning');
      expect(noUseCase[0].refs).toHaveLength(1);
      expect(rule(f, 'usecase.enabler.missing')).toEqual([]);
    });

    it('the small clean set: one use case without an enabler is a note, not a list', () => {
      // 1 of 2 use cases linked is below 80 percent
      const f = check(s => {
        s.useCases[1].enablerId = null;
      });
      expect(rule(f, 'enabler.usecase.missing')[0].severity).toBe('info');
      expect(rule(f, 'usecase.enabler.missing')[0].summary).toContain(
        '(1 von 2)'
      );
    });
  });

  it('a catalog without any use case is no gap per enabler', () => {
    const f = check(s => {
      s.useCases = [];
      s.documents = s.documents.filter(d => !d.useCaseId);
      s.mappings = s.mappings.filter(m => !m.useCaseId);
    });
    expect(rule(f, 'enabler.usecase.missing')).toEqual([]);
  });

  it('order index: duplicate is a warning, a gap a note', () => {
    const dup = check(s => {
      s.enablers[1].orderIndex = 1;
    });
    expect(rule(dup, 'enabler.order.duplicate')[0]).toMatchObject({
      severity: 'warning',
    });
    const gap = check(s => {
      s.enablers[1].orderIndex = 4;
      s.useCases[1].orderIndex = 9;
    });
    expect(rule(gap, 'enabler.order.gap')[0]).toMatchObject({
      severity: 'info',
    });
    expect(rule(gap, 'usecase.order.gap')).toHaveLength(1);
    // Starting at 0 or 1 is no gap
    const zero = check(s => {
      s.enablers[0].orderIndex = 0;
      s.enablers[1].orderIndex = 1;
    });
    expect(rule(zero, 'enabler.order.gap')).toEqual([]);
  });

  it('order index is checked per course', () => {
    const f = check(s => {
      s.courses.push({
        id: 'c2',
        code: 'K2',
        title: 'Zweite',
        description: null,
        trainingComponentId: null,
        isActive: true,
      });
      // Index 1 as well as enabler 1 of course c1, but in another course
      addCompleteEnabler(s, 1, { courseId: 'c2', id: 'y1', code: 'K2-a' });
    });
    expect(rule(f, 'enabler.order.duplicate')).toEqual([]);
  });

  it('active enabler in a course that is not released', () => {
    const f = check(s => {
      s.courses[0].isActive = false;
    });
    expect(rule(f, 'course.inactive.activeEnablers')[0].severity).toBe(
      'warning'
    );
  });

  it('inactive content: a note, a warning when a quarter or more is off in an active catalog', () => {
    const few = check(s => {
      for (let n = 3; n <= 11; n += 1) {
        addCompleteEnabler(s, n, { isActive: n !== 3 });
      }
    });
    const note = rule(few, 'enabler.inactive')[0];
    expect(note.severity).toBe('info');
    expect(note.summary).toContain('1 von 11 Enabler');

    const half = check(s => {
      s.enablers[0].isActive = false;
    });
    expect(rule(half, 'enabler.inactive')[0].severity).toBe('warning');

    const draft = check(s => {
      s.catalog.isActive = false;
      s.enablers[0].isActive = false;
    });
    expect(rule(draft, 'enabler.inactive')[0].severity).toBe('info');
  });

  it('inactive use cases and quizzes are reported too', () => {
    const f = check(s => {
      s.useCases[0].isActive = false;
      s.quizzes[0].isActive = false;
    });
    expect(rule(f, 'usecase.inactive')).toHaveLength(1);
    expect(rule(f, 'quiz.inactive')).toHaveLength(1);
  });
});

describe('quizzes and questions', () => {
  it('enabler without all three lesson quizzes names the missing levels', () => {
    const f = check(s => {
      s.quizzes = s.quizzes.filter(
        z => !(z.enablerId === 'en1' && z.difficulty === 'HIGH')
      );
      s.quizzes = s.quizzes.filter(z => z.enablerId !== 'en2');
    });
    const hit = rule(f, 'enabler.quiz.missing')[0];
    expect(hit.severity).toBe('error');
    expect(hit.refs).toHaveLength(2);
    expect(hit.refs[0].label).toContain('fehlt: HIGH');
    expect(hit.refs[1].label).toContain('fehlt: LOW, MEDIUM, HIGH');
  });

  it('a quiz of the type GLOBAL does not count as a lesson quiz', () => {
    const f = check(s => {
      s.quizzes[0].type = 'GLOBAL';
    });
    expect(rule(f, 'enabler.quiz.missing')).toHaveLength(1);
  });

  it('quiz without questions', () => {
    const f = check(s => {
      s.quizzes[0].questionCount = 0;
    });
    expect(rule(f, 'quiz.empty')[0]).toMatchObject({ severity: 'error' });
  });

  it('question without a correct answer, one with several, one with few options', () => {
    const f = check(s => {
      s.questions[0].correctCount = 0;
      s.questions[1].correctCount = 2;
      s.questions[2].optionCount = 1;
    });
    expect(rule(f, 'question.correct.missing')[0].severity).toBe('error');
    const multiple = rule(f, 'question.correct.multiple')[0];
    expect(multiple.severity).toBe('info');
    expect(multiple.details).toContain('Einfachauswahl');
    expect(rule(f, 'question.options.few')[0].severity).toBe('warning');
  });

  it('a free text question needs no options', () => {
    const f = check(s => {
      s.questions[0].type = 'TEXT';
      s.questions[0].optionCount = 0;
      s.questions[0].correctCount = 0;
    });
    expect(rule(f, 'question.correct.missing')).toEqual([]);
    expect(rule(f, 'question.options.few')).toEqual([]);
  });

  it('question with an empty text and an empty answer', () => {
    const f = check(s => {
      s.questions[0].text = '';
      s.questions[1].emptyOptionCount = 1;
    });
    expect(rule(f, 'question.text.empty')[0].severity).toBe('error');
    expect(rule(f, 'question.option.empty')[0].severity).toBe('error');
    // An empty text is not also reported as a duplicate of another empty text
    expect(rule(f, 'question.duplicate')).toEqual([]);
  });

  it('duplicate question inside one quiz, but not across quizzes', () => {
    const f = check(s => {
      const [first] = s.questions;
      s.questions.push({
        ...first,
        id: 'copy1',
        text: `  ${first.text.toUpperCase()}  `,
      });
      // The same text in another quiz is allowed
      s.questions.push({ ...s.questions[2], id: 'other', text: first.text });
    });
    const hit = rule(f, 'question.duplicate');
    expect(hit).toHaveLength(1);
    expect(hit[0].refs.map(r => r.id)).toEqual(['copy1']);
  });
});

describe('documents', () => {
  it('enabler without a theory document', () => {
    const f = check(s => {
      s.documents = s.documents.filter(d => d.id !== 'th-en1');
    });
    expect(rule(f, 'enabler.theory.missing')[0].refs[0].id).toBe('en1');
  });

  it('enabler without a scenario, by the counting rule of the statistics', () => {
    const f = check(s => {
      s.documents = s.documents.filter(d => d.id !== 'sc-en1');
    });
    expect(rule(f, 'enabler.scenario.missing')[0].refs[0].id).toBe('en1');
  });

  it('the scenario counting rule: PDF, EXERCISE, or a titled import document', () => {
    const e = enabler(1);
    expect(enablerHasScenario(e, [])).toBe(false);
    expect(enablerHasScenario({ ...e, hasScenarioPdf: true }, [])).toBe(true);
    expect(enablerHasScenario(e, [doc('d', { type: 'EXERCISE' })])).toBe(true);
    expect(
      enablerHasScenario(e, [
        doc('d', {
          type: 'TRAINEE_QUESTION',
          title: 'Szenario K1-a: Ausgangssituation',
        }),
      ])
    ).toBe(true);
    expect(
      enablerHasScenario(e, [
        doc('d', { type: 'TRAINER_SOLUTION', title: 'Szenario K1-a: Lösung' }),
      ])
    ).toBe(true);
    // Another code, or another type: no scenario
    expect(
      enablerHasScenario(e, [
        doc('d', {
          type: 'TRAINEE_QUESTION',
          title: 'Szenario K1-b: Ausgangssituation',
        }),
        doc('e', { type: 'THEORY', title: 'Szenario K1-a: Theorie' }),
      ])
    ).toBe(false);
    // An enabler without a code cannot match a title
    expect(
      enablerHasScenario({ ...e, code: null }, [
        doc('d', { type: 'TRAINEE_QUESTION', title: 'Szenario null: x' }),
      ])
    ).toBe(false);
  });

  it('scenario part numbers: Part 1, 2, 4 has a gap at 3', () => {
    expect(
      scenarioPartNumbers([
        'Szenario: Part 1: A',
        'Part 2: B',
        'Szenario: Part 4: D',
        'Szenario: Part 4a: D',
        'Ohne Nummer',
      ])
    ).toEqual([1, 2, 4]);
    const f = check(s => {
      for (const n of [2, 4]) {
        s.documents.push(
          doc(`p${n}`, {
            enablerId: 'en1',
            type: 'EXERCISE',
            title: `Szenario: Part ${n}: Thema ${n}`,
          })
        );
      }
    });
    const hit = rule(f, 'scenario.part.gap')[0];
    expect(hit.severity).toBe('warning');
    expect(hit.refs[0].label).toContain('fehlt: 3');
  });

  it('scenario parts without a gap, or a single part, are fine', () => {
    const f = check(s => {
      s.documents.push(
        doc('p2', { enablerId: 'en1', type: 'EXERCISE', title: 'Part 2: x' })
      );
    });
    expect(rule(f, 'scenario.part.gap')).toEqual([]);
  });

  it('use case without a task document or without a trainer solution', () => {
    const f = check(s => {
      s.documents = s.documents.filter(d => d.id !== 'ta-1' && d.id !== 'lo-2');
    });
    expect(rule(f, 'usecase.task.missing')[0].refs[0].id).toBe('uc1');
    expect(rule(f, 'usecase.solution.missing')[0].refs[0].id).toBe('uc2');
  });

  it('document without a file and without a text; a text-only scenario part is fine', () => {
    const f = check(s => {
      s.documents.push(
        doc('empty', { enablerId: 'en1', hasFile: false, hasText: false }),
        doc('textual', {
          enablerId: 'en1',
          type: 'TRAINEE_QUESTION',
          hasFile: false,
          hasText: true,
        }),
        doc('noname', { enablerId: 'en1', fileName: '  ' })
      );
    });
    const hit = rule(f, 'document.file.missing')[0];
    expect(hit.severity).toBe('error');
    expect(hit.refs.map(r => r.id).sort()).toEqual(['empty', 'noname']);
  });

  it('suspected copies: same type, size and page count in different enablers', () => {
    const f = check(s => {
      s.documents = s.documents.map(d =>
        d.type === 'THEORY' ? { ...d, fileSize: 52_000, pageCount: 12 } : d
      );
    });
    const hit = rule(f, 'document.copy.suspected')[0];
    expect(hit.severity).toBe('info');
    expect(hit.refs).toHaveLength(1);
    expect(hit.details).toContain('kein Beweis');
  });

  it('no copy hint for small files, unknown sizes, one enabler or another type', () => {
    const big = { fileSize: 9000, pageCount: 3 };
    const f = check(s => {
      s.documents = s.documents.map(d =>
        d.type === 'THEORY' ? { ...d, fileSize: 500, pageCount: 1 } : d
      );
      s.documents.push(
        doc('a', { enablerId: 'en1', type: 'REFERENCE', ...big }),
        doc('b', { enablerId: 'en1', type: 'REFERENCE', ...big }),
        doc('c', { enablerId: 'en2', type: 'OTHER', ...big }),
        doc('d', {
          enablerId: 'en2',
          type: 'REFERENCE',
          fileSize: 9000,
          pageCount: null,
        })
      );
    });
    expect(rule(f, 'document.copy.suspected')).toEqual([]);
  });
});

describe('identical copies by checksum', () => {
  const SHA = 'a'.repeat(64);
  const OTHER = 'b'.repeat(64);

  it('the same checksum in different enablers is a note naming the second document', () => {
    const f = check(s => {
      s.documents = s.documents.map(d =>
        d.type === 'THEORY' ? { ...d, contentSha256: SHA } : d
      );
    });
    const hit = rule(f, 'document.copy.identical');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'info', category: 'document' });
    expect(hit[0].refs).toHaveLength(1);
    expect(hit[0].details).toContain('SHA-256');
  });

  it('different checksums, one enabler, an empty file or no checksum give no finding', () => {
    const EMPTY =
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const f = check(s => {
      s.documents.push(
        doc('p', { enablerId: 'en1', type: 'REFERENCE', contentSha256: SHA }),
        doc('q', { enablerId: 'en1', type: 'REFERENCE', contentSha256: SHA }),
        doc('r', { enablerId: 'en1', type: 'OTHER', contentSha256: OTHER }),
        doc('s', { enablerId: 'en2', type: 'OTHER', contentSha256: EMPTY }),
        doc('t', { enablerId: 'en1', type: 'OTHER', contentSha256: EMPTY }),
        doc('u', { enablerId: 'en2', type: 'OTHER' })
      );
    });
    expect(rule(f, 'document.copy.identical')).toEqual([]);
  });

  it('use case documents with the same checksum count as well', () => {
    const f = check(s => {
      s.documents = s.documents.map(d =>
        d.type === 'TRAINER_SOLUTION' ? { ...d, contentSha256: SHA } : d
      );
    });
    expect(rule(f, 'document.copy.identical')).toHaveLength(1);
  });

  it('documents with a checksum are left out of the hint on size and pages, the others stay', () => {
    let n = 0;
    const f = check(s => {
      s.documents = s.documents.map(d =>
        d.type === 'THEORY'
          ? {
              ...d,
              fileSize: 52_000,
              pageCount: 12,
              contentSha256: String(n++).repeat(64),
            }
          : d
      );
    });
    // both have a checksum and the checksums differ: neither rule fires
    expect(rule(f, 'document.copy.suspected')).toEqual([]);
    expect(rule(f, 'document.copy.identical')).toEqual([]);

    const mixed = check(s => {
      let first = true;
      s.documents = s.documents.map(d => {
        if (d.type !== 'THEORY') return d;
        const out = {
          ...d,
          fileSize: 52_000,
          pageCount: 12,
          contentSha256: first ? OTHER : null,
        };
        first = false;
        return out;
      });
    });
    // one without a checksum alone makes no pair
    expect(rule(mixed, 'document.copy.suspected')).toEqual([]);
  });
});

describe('titles and texts', () => {
  it('empty title', () => {
    const f = check(s => {
      s.enablers[0].title = '   ';
    });
    expect(rule(f, 'title.empty')[0]).toMatchObject({
      severity: 'error',
      category: 'text',
    });
  });

  it('glued words, with the exception list and plain compounds left alone', () => {
    const f = check(s => {
      s.enablers[0].title = 'Texte gestaltenInhaltsverzeichnis erstellen';
      s.enablers[1].title =
        'Mit PostgreSQL und GitHub, JavaScript, DevOps arbeiten';
      s.courses[0].title =
        'Netzwerktechnik und IT-Sicherheit (IPv6, iPhone, eBay)';
    });
    const hit = rule(f, 'title.glued');
    expect(hit).toHaveLength(1);
    expect(hit[0].refs).toHaveLength(1);
    expect(hit[0].refs[0].label).toContain('gestaltenInhaltsverzeichnis');
    expect(hit[0].severity).toBe('warning');
  });

  it('broken encoding', () => {
    const f = check(s => {
      s.enablers[0].title = 'Pr' + String.fromCharCode(0xc3, 0xbc) + 'fung';
      s.enablers[1].title =
        'Titel mit ' + String.fromCharCode(0xfffd) + ' Zeichen';
    });
    expect(rule(f, 'title.encoding')[0].refs).toHaveLength(2);
    expect(rule(f, 'title.encoding')[0].severity).toBe('error');
  });

  it('duplicate title inside one course, not across courses and not for courses', () => {
    const f = check(s => {
      s.enablers[1].title = ' enabler 1 THEMA ';
    });
    expect(rule(f, 'title.duplicate')[0].refs[0].id).toBe('en2');
    const courses = check(s => {
      s.courses.push({ ...s.courses[0], id: 'c2', code: 'K2' });
      addCompleteEnabler(s, 7, {
        id: 'y7',
        courseId: 'c2',
        title: 'Enabler 1 Thema',
        code: 'K2-a',
      });
    });
    expect(rule(courses, 'title.duplicate')).toEqual([]);
    // A base course and its Vertiefung may share a title
    const same = check(s => {
      s.courses.push({ ...s.courses[0], id: 'c3', code: 'K3' });
      addCompleteEnabler(s, 8, { id: 'y8', courseId: 'c3', code: 'K3-a' });
    });
    expect(rule(same, 'title.duplicate')).toEqual([]);
  });

  it('description equal to the title is a note', () => {
    const f = check(s => {
      s.enablers[0].description = '  ENABLER 1 Thema ';
      s.useCases[0].description = s.useCases[0].title;
    });
    const hit = rule(f, 'description.equalsTitle')[0];
    expect(hit.severity).toBe('info');
    expect(hit.refs.map(r => r.type).sort()).toEqual(['enabler', 'useCase']);
  });
});

describe('learning fields', () => {
  it('enabler and use case without a learning field, learning field without content', () => {
    const f = check(s => {
      s.mappings = [
        { learningFieldId: 'lf1', enablerId: 'en1', useCaseId: null },
      ];
      s.learningFields.push({ id: 'lf2', code: 'LF2', title: 'Leer' });
    });
    expect(rule(f, 'enabler.learningField.missing')[0].refs[0].id).toBe('en2');
    expect(rule(f, 'usecase.learningField.missing')[0].refs).toHaveLength(2);
    expect(rule(f, 'learningField.empty')[0]).toMatchObject({
      severity: 'info',
      refs: [{ type: 'learningField', id: 'lf2', label: 'LF2: Leer' }],
    });
  });

  it('a catalog without any assignment does not use learning fields: no finding', () => {
    const f = check(s => {
      s.mappings = [];
    });
    expect(rule(f, 'enabler.learningField.missing')).toEqual([]);
    expect(rule(f, 'learningField.empty')).toEqual([]);
  });
});

describe('comparison with the plan (source plan)', () => {
  const component = (
    id: string,
    weeks: number,
    phase: number | null,
    kind = 'pflicht',
    hours = weeks * 40
  ) => ({
    id,
    code: id,
    title: id,
    totalWeeks: weeks,
    totalHours: hours,
    phase,
    kind,
  });

  it('hours that do not fit the weeks', () => {
    const f = check(s => {
      s.components.push(component('t1', 4, 1, 'pflicht', 100));
    });
    const hit = rule(f, 'plan.hours.weeks')[0];
    expect(hit).toMatchObject({
      source: 'plan',
      severity: 'warning',
      category: 'plan',
    });
    expect(hit.refs[0].label).toContain('4 Wochen, 100 Stunden');
  });

  it('more weeks in a phase than the phase has', () => {
    // 18 months are 78 weeks
    const f = check(s => {
      s.catalog.settings = { phase_months: [18, 18] };
      s.components.push(
        component('a', 50, 1),
        component('b', 40, 1),
        component('c', 78, 2)
      );
    });
    const hit = rule(f, 'plan.hours.phase');
    expect(hit).toHaveLength(1);
    expect(hit[0].source).toBe('plan');
    expect(hit[0].summary).toContain('Phase 1');
    expect(hit[0].summary).toContain('90 Wochen');
    expect(hit[0].summary).toContain('78 Wochen');
  });

  it('fewer weeks only count without electives', () => {
    const without = check(s => {
      s.catalog.settings = { phase_months: [18, 18] };
      s.components.push(component('a', 78, 1), component('b', 40, 2));
    });
    expect(rule(without, 'plan.hours.phase')[0].summary).toContain('Phase 2');
    const withElectives = check(s => {
      s.catalog.settings = { phase_months: [18, 18] };
      s.components.push(
        component('a', 78, 1),
        component('b', 40, 2),
        component('w', 20, null, 'wahl')
      );
    });
    expect(rule(withElectives, 'plan.hours.phase')).toEqual([]);
  });

  it('within the tolerance of two weeks nothing is reported', () => {
    const f = check(s => {
      s.catalog.settings = { phase_months: [18, 18] };
      s.components.push(component('a', 76, 1), component('b', 80, 2));
    });
    expect(rule(f, 'plan.hours.phase')).toEqual([]);
  });

  it('deviation from the targets, from the statistics of the catalog', () => {
    const metric = (id: string, actual: number, target: number | null) => ({
      id: id as never,
      actual,
      active: null,
      target,
      difference: target === null ? null : actual - target,
      status:
        target === null
          ? ('no_target' as const)
          : actual === target
            ? ('met' as const)
            : actual < target
              ? ('missing' as const)
              : ('exceeds' as const),
      percent: null,
    });
    const findings = runScriptRules(cleanSnapshot(), {
      catalogId: CATALOG,
      code: 'TEST',
      title: 'Testberuf',
      isActive: true,
      metrics: [
        metric('enablers', 2, 2),
        metric('scenarios', 1, 3),
        metric('useCases', 5, 3),
        metric('components', 1, null),
      ],
      questions: 0,
      mappings: 0,
    });
    const plan = findings.filter(f => f.source === 'plan');
    expect(plan.map(f => f.rule)).toEqual([
      'plan.target.scenarios',
      'plan.target.useCases',
    ]);
    expect(plan[0]).toMatchObject({ severity: 'warning', category: 'plan' });
    expect(plan[0].summary).toBe('Es fehlen 2 Szenarien gegenüber dem Soll.');
    expect(plan[0].details).toBe('Ist 1, Soll 3.');
    expect(plan[1]).toMatchObject({ severity: 'info' });
    expect(plan[1].summary).toBe('Es gibt 2 Use Cases mehr als im Soll.');
  });
});

describe('limits of a finding', () => {
  it('names at most 20 objects and says the total in the details', () => {
    const f = check(s => {
      for (let n = 3; n < 3 + 45; n += 1) {
        s.enablers.push(enabler(n, { id: `x${n}`, title: `Zusatz ${n}` }));
      }
    });
    const hit = rule(f, 'enabler.quiz.missing')[0];
    expect(hit.refs).toHaveLength(MAX_REFS);
    expect(hit.details).toContain('Betroffen: 45');
    expect(hit.details).toContain('die ersten 20');
    expect(hit.summary.startsWith('45 Enabler haben')).toBe(true);
  });

  it('a single object reads in the singular', () => {
    const f = check(s => {
      s.quizzes[0].questionCount = 0;
    });
    expect(rule(f, 'quiz.empty')[0].summary).toBe('1 Quiz hat keine Fragen.');
  });

  it('does not use a dash as punctuation in a message', () => {
    const dash = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]| - `);
    const f = check(s => {
      s.quizzes = [];
      s.documents = [];
      s.questions = [];
      s.enablers[0].title = 'zusammenGeklebt';
    });
    expect(f.length).toBeGreaterThan(5);
    for (const finding of f) {
      for (const text of [
        finding.summary,
        finding.details ?? '',
        finding.hint ?? '',
      ]) {
        expect(text).not.toMatch(dash);
      }
    }
  });
});
