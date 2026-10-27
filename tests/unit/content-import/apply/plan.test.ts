import {
  buildImportPlan,
  planCounts,
  renderPlanSummary,
  selectFiles,
  validatePlan,
} from '@/lib/content-import/apply/plan';

import {
  BASE_TIME,
  DIR,
  HOUR,
  completeEnabler,
  enablerContent,
  file,
  globalQuizContent,
  loadDecisions,
  quizContent,
  sampleTree,
  scenarioContent,
} from './fixtures';

const NOW = new Date('2026-10-26T12:00:00Z');
const decisions = loadDecisions();
const build = (files = sampleTree(), d = decisions, limitedTo: string[] = []) =>
  buildImportPlan(files, d, { now: NOW, limitedTo });

describe('buildImportPlan: structure', () => {
  const plan = build();

  it('derives components with code, kind, phase and a stable order', () => {
    expect(
      plan.components.map(c => [c.code, c.kind, c.phase, c.group, c.orderIndex])
    ).toEqual([
      ['K1', 'pflicht', 1, 'teil1', 10],
      ['K6.1', 'pflicht', 1, 'teil1', 61],
      ['K6.2', 'pflicht', 2, 'teil2', 62],
      ['K10', 'wahl', null, 'wahl', 100],
      ['K20', 'integrativ', null, 'ganze', 200],
    ]);
    const k1 = plan.components[0];
    expect(k1.title).toBe('Erfundenes Thema Eins');
    expect(k1.reference).toBe('§ 4 Abs. 2 Nr. 1');
  });

  it('takes the weeks from the training framework plan and leaves the hours as placeholders', () => {
    expect(
      plan.components.map(c => [c.code, c.totalWeeks, c.weeksSource])
    ).toEqual([
      ['K1', 11, 'rahmenplan'],
      ['K6.1', 6, 'rahmenplan'],
      ['K6.2', 11, 'rahmenplan'],
      ['K10', 22, 'rahmenplan'],
      // the plan prints no weeks for the integrative positions
      ['K20', 0, 'none'],
    ]);
    for (const c of plan.components) {
      // the plan has no hours: they stay 0 until the owner decides
      expect(c.totalHours).toBe(0);
      expect(c.provisionalTotals).toBe(true);
    }
    const text = plan.open.join(' ');
    expect(text).toMatch(
      /Planned hours are placeholders \(0\) for 5 component/
    );
    expect(text).not.toMatch(/Weeks are placeholders/);
  });

  it('writes a placeholder for the weeks of a component the table does not know', () => {
    const files = [
      ...sampleTree(),
      ...completeEnabler(DIR.k26, '26', 'a'),
      file(
        `${DIR.k26}/Global Quiz/26_Global_Quiz_Thema.docx`,
        globalQuizContent('26')
      ),
    ];
    const d = loadDecisions(raw => {
      raw.components.mandatoryNumbers.push(26);
    });
    const p = build(files, d);
    const unknown = p.components.find(c => c.code === 'K26');
    expect(unknown).toMatchObject({
      totalWeeks: 0,
      weeksSource: 'placeholder',
      provisionalTotals: true,
    });
    expect(p.open.join(' ')).toMatch(
      /Weeks are placeholders \(0\) for 1 component/
    );
  });

  it('uses the totals of the decisions where they exist, before the plan', () => {
    const d = loadDecisions(raw => {
      raw.components.totalWeeks = { K1: 4 };
      raw.components.totalHours = { K1: 160 };
    });
    const p = build(sampleTree(), d);
    const k1 = p.components.find(c => c.code === 'K1')!;
    expect([
      k1.totalWeeks,
      k1.weeksSource,
      k1.totalHours,
      k1.provisionalTotals,
    ]).toEqual([4, 'decision', 160, false]);
    const k10 = p.components.find(c => c.code === 'K10')!;
    expect([k10.totalWeeks, k10.provisionalTotals]).toEqual([22, true]);
  });

  it('plans enablers with the code of the plan and the title of the heading', () => {
    expect(plan.enablers.map(e => e.code)).toEqual([
      'K1-a',
      'K1-b',
      'K6.1-a',
      'K6.2-d',
      'K10-a',
      'K20-a',
    ]);
    const a = plan.enablers.find(e => e.code === 'K1-a')!;
    expect(a.title).toBe('Erfundenes Enabler-Thema');
    expect(a.orderIndex).toBe(1);
    expect(plan.enablers.find(e => e.code === 'K6.2-d')!.orderIndex).toBe(4);
    expect(a.descriptionText).toBe(
      'Erfundener Lehrtext, erster Absatz.\n\nZweiter Absatz.'
    );
  });

  it('leaves the enabler text out when the presets say so', () => {
    const d = loadDecisions(raw => {
      raw.content.enablerText = false;
    });
    const p = build(sampleTree(), d);
    expect(p.enablers.every(e => e.descriptionText === null)).toBe(true);
  });

  it('plans three lesson quizzes per enabler and one global quiz per component', () => {
    const lesson = plan.quizzes.filter(q => q.kind === 'lesson');
    const global = plan.quizzes.filter(q => q.kind === 'global');
    expect(lesson).toHaveLength(18);
    expect(global.map(q => q.code)).toEqual([
      'K1-global',
      'K6.1-global',
      'K6.2-global',
      'K10-global',
      'K20-global',
    ]);
    expect(lesson.map(q => q.code)).toContain('K6.2-d-medium');
    const low = lesson.find(q => q.code === 'K1-a-low')!;
    expect([low.enablerCode, low.componentCode, low.level]).toEqual([
      'K1-a',
      'K1',
      'low',
    ]);
    expect(global[0].enablerCode).toBeNull();
    expect(global[0].level).toBeNull();
    expect(global[0].questions).toHaveLength(20);
  });

  it('marks exactly one correct option per question and puts the rationale on it', () => {
    for (const quiz of plan.quizzes) {
      for (const q of quiz.questions) {
        expect(q.options.map(o => o.letter)).toEqual(['A', 'B', 'C', 'D']);
        const correct = q.options.filter(o => o.isCorrect);
        expect(correct).toHaveLength(1);
        expect(correct[0].letter).toBe('B');
        expect(correct[0].explanation).toMatch(/^Erfundene Begründung ZETA-/);
        for (const o of q.options.filter(o => !o.isCorrect)) {
          expect(o.explanation).toBeNull();
        }
      }
    }
  });

  it('keeps the difficulty band of global questions', () => {
    const g = plan.quizzes.find(q => q.code === 'K1-global')!;
    expect(g.questions[0].difficulty).toBe('low');
    expect(g.questions[7].difficulty).toBe('medium');
    expect(g.questions[19].difficulty).toBe('high');
    const lesson = plan.quizzes.find(q => q.code === 'K1-a-low')!;
    expect(lesson.questions[0].difficulty).toBeNull();
  });

  it('keeps the scenario parts apart', () => {
    expect(plan.scenarios).toHaveLength(6);
    const s = plan.scenarios.find(x => x.enablerCode === 'K1-a')!;
    expect(s.situation).toBe('Eine erfundene Lage am Arbeitsplatz.');
    expect(s.solution).toBe('Eine erfundene Lösung OMEGA.');
    expect(s.knowledgeContribution).toBe('Ein erfundener Beitrag SIGMA.');
  });

  it('keeps a task of a scenario in its own field and adds nothing to the others', () => {
    const files = sampleTree().filter(f => !f.rel.endsWith('Szenario_1a.docx'));
    files.push(
      file(
        `${DIR.k1}/Enablers/1a_Thema/Szenario/Szenario_1a.docx`,
        scenarioContent('1a', { task: 'Eine erfundene Aufgabe TAU.' })
      )
    );
    const p = build(files);
    const s = p.scenarios.find(x => x.enablerCode === 'K1-a')!;
    expect(s.task).toBe('Eine erfundene Aufgabe TAU.');
    expect(s.situation).toBe('Eine erfundene Lage am Arbeitsplatz.');
    expect(s.solution).not.toContain('TAU');
    expect(s.knowledgeContribution).not.toContain('TAU');
    // the other scenarios keep exactly the shape they had before
    const others = p.scenarios.filter(x => x.enablerCode !== 'K1-a');
    expect(others).toHaveLength(5);
    for (const other of others) expect('task' in other).toBe(false);
    expect(p.skipped).toEqual([]);
    expect(validatePlan(p)).toEqual([]);
  });

  it('reads a scenario whose solution heading says Aufgabe as the solution, with a note', () => {
    const files = sampleTree().filter(f => !f.rel.endsWith('Szenario_1a.docx'));
    files.push(
      file(
        `${DIR.k1}/Enablers/1a_Thema/Szenario/Szenario_1a.docx`,
        scenarioContent('1a', { solutionHeading: 'Aufgabe' })
      )
    );
    const p = build(files);
    const s = p.scenarios.find(x => x.enablerCode === 'K1-a')!;
    expect(s.solution).toBe('Eine erfundene Lösung OMEGA.');
    expect('task' in s).toBe(false);
    expect(p.skipped).toEqual([]);
    expect(p.warnings.join(' ')).toMatch(/1a: TASK_AS_SOLUTION/);
    expect(validatePlan(p)).toEqual([]);
  });

  it('skips a scenario whose task shows a solution marker or repeats a solution paragraph', () => {
    const files = sampleTree().filter(
      f => !/Szenario_1[ab]\.docx$/.test(f.rel)
    );
    files.push(
      file(
        `${DIR.k1}/Enablers/1a_Thema/Szenario/Szenario_1a.docx`,
        scenarioContent('1a', {
          task: 'Eine erfundene Frage. Richtige Antwort: B',
        })
      ),
      file(
        `${DIR.k1}/Enablers/1b_Thema/Szenario/Szenario_1b.docx`,
        scenarioContent('1b', { task: 'Eine erfundene Lösung OMEGA.' })
      )
    );
    const p = build(files);
    const codes = Object.fromEntries(p.skipped.map(s => [s.key, s.code]));
    expect(codes['scenario:K1-a']).toBe('SOLUTION_MARKER');
    expect(codes['scenario:1b']).toBe('PARSE_ERROR');
    expect(p.scenarios.map(s => s.enablerCode)).not.toContain('K1-a');
    expect(p.scenarios.map(s => s.enablerCode)).not.toContain('K1-b');
  });

  it('counts everything and skips nothing for a clean tree', () => {
    expect(planCounts(plan)).toEqual({
      components: 5,
      enablers: 6,
      scenarios: 6,
      quizzes: 23,
      lessonQuizzes: 18,
      globalQuizzes: 5,
      questions: 18 * 10 + 5 * 20,
      options: (18 * 10 + 5 * 20) * 4,
      skipped: 0,
      superseded: 0,
    });
    expect(plan.skipped).toEqual([]);
  });

  it('is the same for any order of the input files and keeps the date out of the content', () => {
    const files = sampleTree();
    const shuffled = [...files].reverse();
    expect(build(shuffled)).toEqual(build(files));
    expect(plan.generatedAt).toBe(NOW.toISOString());
  });
});

describe('buildImportPlan: what is left out', () => {
  it('does not plan K18, archive files, PDFs and use cases, it only counts them', () => {
    const files = [
      ...sampleTree(),
      ...completeEnabler(DIR.k18, '18', 'a'),
      file(
        `${DIR.k1}/Enablers/1a_Thema/Archiv/1a_v2.docx`,
        enablerContent('1a) Alt')
      ),
      file(`${DIR.k1}/K1_Use-Cases/UC_1a_Aufgabe.docx`),
      file('00_Global_Quizze/PDF/01_Global_Quiz_Thema.pdf'),
    ];
    const p = build(files);
    expect(p.components.map(c => c.code)).not.toContain('K18');
    expect(p.notPlanned).toMatchObject({
      excluded: 5,
      archive: 1,
      'use-case': 1,
      pdf: 1,
    });
    expect(planCounts(p).enablers).toBe(6);
    expect(p.skipped).toEqual([]);
  });

  it('skips a quiz with a format error with its code, not with its content', () => {
    const files = sampleTree().filter(
      f => !f.rel.endsWith('1a_Quiz_Medium.docx')
    );
    files.push(
      file(
        `${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Medium.docx`,
        quizContent({
          heading: '1a) Erfundenes Enabler-Thema',
          level: 'mittel',
          tag: 'bad',
          skipAnswerOf: 3,
        })
      )
    );
    const p = build(files);
    const skip = p.skipped.find(s => s.key === 'quiz:1a:medium')!;
    expect(skip.code).toBe('PARSE_ERROR');
    expect(skip.reason).toMatch(/ANSWER_MISSING/);
    expect(skip.reason).not.toMatch(/Erfundene Frage/);
    expect(p.quizzes.map(q => q.code)).not.toContain('K1-a-medium');
    // the rest of the enabler stays
    expect(p.quizzes.map(q => q.code)).toContain('K1-a-low');
    expect(p.enablers.map(e => e.code)).toContain('K1-a');
  });

  it('skips a file whose heading names another enabler, another level or another component', () => {
    const files = sampleTree().filter(
      f =>
        !f.rel.endsWith('1b_Quiz_Low.docx') &&
        !f.rel.endsWith('1b_Quiz_High.docx') &&
        !f.rel.endsWith('Szenario_1b.docx') &&
        !f.rel.includes('01_Global_Quiz')
    );
    files.push(
      file(
        `${DIR.k1}/Enablers/1b_Thema/Quiz/1b_Quiz_Low.docx`,
        quizContent({ heading: '1c) Falscher Code', level: 'leicht', tag: 'x' })
      ),
      file(
        `${DIR.k1}/Enablers/1b_Thema/Quiz/1b_Quiz_High.docx`,
        quizContent({ heading: '1b) Thema', level: 'leicht', tag: 'y' })
      ),
      file(
        `${DIR.k1}/Enablers/1b_Thema/Szenario/Szenario_1b.docx`,
        scenarioContent('1c')
      ),
      file(
        `${DIR.k1}/Global Quiz/01_Global_Quiz_Thema.docx`,
        globalQuizContent('02')
      )
    );
    const p = build(files);
    const codes = Object.fromEntries(p.skipped.map(s => [s.key, s.code]));
    expect(codes['quiz:1b:low']).toBe('CODE_MISMATCH');
    expect(codes['quiz:1b:high']).toBe('DIFFICULTY_MISMATCH');
    expect(codes['scenario:1b']).toBe('CODE_MISMATCH');
    expect(codes['global-quiz:01']).toBe('CODE_MISMATCH');
  });

  it('accepts a heading without the split and with a loose form (only a warning)', () => {
    const files = sampleTree().filter(f => !f.rel.endsWith('6d_Quiz_Low.docx'));
    files.push(
      file(
        `${DIR.k6_2}/Enablers/6d_Thema/Quiz/6d_Quiz_Low.docx`,
        quizContent({
          heading: 'Quiz 6d: Erfundenes Thema',
          level: 'leicht',
          tag: 'v',
        })
      )
    );
    expect(build(files).quizzes.map(q => q.code)).toContain('K6.2-d-low');
  });

  it('skips a global quiz without 20 questions', () => {
    const files = sampleTree().filter(f => !f.rel.includes('01_Global_Quiz'));
    files.push(
      file(
        `${DIR.k1}/Global Quiz/01_Global_Quiz_Thema.docx`,
        globalQuizContent('01', 19)
      )
    );
    const p = build(files);
    expect(p.skipped.find(s => s.key === 'global-quiz:01')!.reason).toMatch(
      /QUESTION_COUNT/
    );
    expect(p.quizzes.map(q => q.code)).not.toContain('K1-global');
  });

  it('skips an enabler without usable text and everything that hangs on it', () => {
    const files = sampleTree().filter(f => !f.rel.endsWith('1b_Thema/1b.docx'));
    files.push(
      file(`${DIR.k1}/Enablers/1b_Thema/1b.docx`, undefined, {
        readError: 'Timeout after 60000 ms while reading the file',
      })
    );
    const p = build(files);
    expect(p.enablers.map(e => e.code)).not.toContain('K1-b');
    expect(
      p.quizzes.map(q => q.code).filter(c => c.startsWith('K1-b'))
    ).toEqual([]);
    expect(p.scenarios.map(s => s.enablerCode)).not.toContain('K1-b');
    const codes = p.skipped.map(s => `${s.key}:${s.code}`);
    expect(codes).toContain('enabler:1b:READ_ERROR');
    expect(codes).toContain('quiz:1b:low:ENABLER_MISSING');
    expect(codes).toContain('scenario:1b:ENABLER_MISSING');
  });

  it('skips an enabler without a heading', () => {
    const files = sampleTree().filter(f => !f.rel.endsWith('1b_Thema/1b.docx'));
    files.push(
      file(`${DIR.k1}/Enablers/1b_Thema/1b.docx`, enablerContent(null, []))
    );
    const p = build(files);
    expect(p.skipped.find(s => s.key === 'enabler:1b')!.code).toBe(
      'NO_HEADING'
    );
    expect(p.enablers.map(e => e.code)).not.toContain('K1-b');
  });

  it('skips a file that is still a OneDrive placeholder', () => {
    const files = sampleTree().filter(f => !f.rel.endsWith('1a_Quiz_Low.docx'));
    files.push(
      file(`${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Low.docx`, undefined, {
        placeholder: true,
      })
    );
    const p = build(files);
    expect(p.skipped.find(s => s.key === 'quiz:1a:low')!.code).toBe(
      'PLACEHOLDER'
    );
  });

  it('skips files whose path does not fit the scheme', () => {
    const files = [
      ...sampleTree(),
      file(
        `${DIR.k1}/Enablers/1a_Thema/Szenario/Szenario_9z.docx`,
        scenarioContent('1a')
      ),
    ];
    const p = build(files);
    const skip = p.skipped.find(s => s.file?.endsWith('Szenario_9z.docx'))!;
    expect(skip.code).toBe('PATH_ISSUE');
    expect(skip.reason).toMatch(/letter-mismatch/);
  });

  it('skips a component nobody decided on, with all its files', () => {
    const files = [
      ...sampleTree(),
      ...completeEnabler(DIR.k26, '26', 'a'),
      file(
        `${DIR.k26}/Global Quiz/26_Global_Quiz_Thema.docx`,
        globalQuizContent('26')
      ),
    ];
    const p = build(files);
    expect(p.components.map(c => c.code)).not.toContain('K26');
    expect(p.skipped.some(s => s.code === 'NO_DECISION')).toBe(true);
    expect(p.enablers.map(e => e.code)).not.toContain('K26-a');
  });

  it('skips a component whose folder group contradicts its kind', () => {
    const d = loadDecisions(raw => {
      raw.components.electiveNumbers = raw.components.electiveNumbers.filter(
        (n: number) => n !== 10
      );
      raw.components.mandatoryNumbers.push(10);
    });
    const p = build(sampleTree(), d);
    // K10 lies in the elective group of the source but the presets say compulsory
    expect(p.components.map(c => c.code)).not.toContain('K10');
    expect(p.skipped.some(s => s.code === 'KIND_GROUP_MISMATCH')).toBe(true);
  });

  it('limits the plan to the named components', () => {
    const p = build(sampleTree(), decisions, ['K1', 'K6.2']);
    expect(p.limitedTo).toEqual(['K1', 'K6.2']);
    expect(p.components.map(c => c.code)).toEqual(['K1', 'K6.2']);
    expect(p.enablers.map(e => e.code)).toEqual(['K1-a', 'K1-b', 'K6.2-d']);
    expect(p.quizzes.filter(q => q.kind === 'global').map(q => q.code)).toEqual(
      ['K1-global', 'K6.2-global']
    );
  });
});

describe('buildImportPlan: duplicates', () => {
  const lowRel = `${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Low.docx`;
  const copyRel = `${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Low_v2.docx`;

  const withCopy = (oldTime: number, newTime: number) => {
    const files = sampleTree().filter(f => f.rel !== lowRel);
    files.push(
      file(
        lowRel,
        quizContent({ heading: '1a) Thema', level: 'leicht', tag: 'old' }),
        { mtimeMs: oldTime }
      ),
      file(
        copyRel,
        quizContent({ heading: '1a) Thema', level: 'leicht', tag: 'new' }),
        { mtimeMs: newTime }
      )
    );
    return files;
  };

  it('takes the newest copy and lists the other one as superseded', () => {
    const p = build(withCopy(BASE_TIME, BASE_TIME + 100 * HOUR));
    const quiz = p.quizzes.find(q => q.code === 'K1-a-low')!;
    expect(quiz.source).toBe(copyRel);
    expect(quiz.questions[0].text).toContain('new1');
    expect(p.superseded).toEqual([
      { file: lowRel, key: 'quiz:1a:low', keptFile: copyRel },
    ]);
    expect(p.skipped).toEqual([]);
  });

  it('prefers the higher version over the later date', () => {
    const p = build(withCopy(BASE_TIME + 100 * HOUR, BASE_TIME));
    expect(p.quizzes.find(q => q.code === 'K1-a-low')!.source).toBe(copyRel);
  });

  it('skips both copies when version and time do not decide (within 24 hours)', () => {
    const files = sampleTree().filter(f => f.rel !== lowRel);
    const copy2 = `${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Low (1).docx`;
    files.push(
      file(
        lowRel,
        quizContent({ heading: '1a) Thema', level: 'leicht', tag: 'a' }),
        {
          mtimeMs: BASE_TIME,
        }
      ),
      file(
        copy2,
        quizContent({ heading: '1a) Thema', level: 'leicht', tag: 'b' }),
        {
          mtimeMs: BASE_TIME + 4 * HOUR,
        }
      )
    );
    const p = build(files);
    const skips = p.skipped.filter(s => s.key === 'quiz:1a:low');
    expect(skips.map(s => s.code)).toEqual([
      'DUPLICATE_AMBIGUOUS',
      'DUPLICATE_AMBIGUOUS',
    ]);
    expect(p.quizzes.map(q => q.code)).not.toContain('K1-a-low');
    expect(p.superseded).toEqual([]);
  });

  it('selectFiles names the files to read, one per key', () => {
    const files = withCopy(BASE_TIME, BASE_TIME + 100 * HOUR);
    const selection = selectFiles(files, decisions);
    expect(selection.chosen).toContain(copyRel);
    expect(selection.chosen).not.toContain(lowRel);
    expect(new Set(selection.chosen).size).toBe(selection.chosen.length);
  });
});

describe('validatePlan', () => {
  const clone = () => JSON.parse(JSON.stringify(build()));

  it('accepts a plan from the planner and a plan read back from JSON', () => {
    expect(validatePlan(build())).toEqual([]);
    expect(validatePlan(clone())).toEqual([]);
  });

  it('rejects another catalog, an unknown version and a missing list', () => {
    const a = clone();
    a.catalog = 'FIAE';
    expect(validatePlan(a).join(' ')).toMatch(/catalog/);
    const b = clone();
    b.version = 2;
    expect(validatePlan(b).join(' ')).toMatch(/version/);
    const c = clone();
    delete c.quizzes;
    expect(validatePlan(c).length).toBeGreaterThan(0);
    expect(validatePlan(null).length).toBeGreaterThan(0);
  });

  it('rejects a question with two correct options or none', () => {
    const a = clone();
    a.quizzes[0].questions[0].options[0].isCorrect = true;
    expect(validatePlan(a).join(' ')).toMatch(/exactly one correct/);
    const b = clone();
    for (const o of b.quizzes[0].questions[0].options) o.isCorrect = false;
    expect(validatePlan(b).join(' ')).toMatch(/exactly one correct/);
  });

  it('rejects an explanation on a wrong option', () => {
    const a = clone();
    a.quizzes[0].questions[0].options[0].explanation = 'Erfunden';
    expect(validatePlan(a).join(' ')).toMatch(/explanation/);
  });

  it('rejects a code that breaks the format of the database, duplicates and orphans', () => {
    const a = clone();
    a.enablers[0].code = 'K1 a';
    expect(validatePlan(a).join(' ')).toMatch(/code/);
    const b = clone();
    b.quizzes[1].code = b.quizzes[0].code;
    expect(validatePlan(b).join(' ')).toMatch(/twice/);
    const c = clone();
    c.enablers[0].componentCode = 'K99';
    expect(validatePlan(c).join(' ')).toMatch(/K99/);
    const d = clone();
    d.quizzes[0].enablerCode = 'K9-z';
    expect(validatePlan(d).join(' ')).toMatch(/K9-z/);
    const e = clone();
    e.scenarios[0].enablerCode = 'K9-z';
    expect(validatePlan(e).join(' ')).toMatch(/K9-z/);
  });

  it('rejects an item without a plain source path and a quiz with wrong question numbers', () => {
    const a = clone();
    a.scenarios[0].source = 'a\nb';
    expect(validatePlan(a).join(' ')).toMatch(/source path/);
    const b = clone();
    delete b.enablers[0].source;
    expect(validatePlan(b).join(' ')).toMatch(/source path/);
    const c = clone();
    c.quizzes[0].questions[1].number = 1;
    expect(validatePlan(c).join(' ')).toMatch(/1 to n/);
  });

  it('rejects a solution that stands in a visible field', () => {
    const a = clone();
    a.quizzes[0].questions[0].text += ' Richtige Antwort: B';
    expect(validatePlan(a).join(' ')).toMatch(/solution/i);
    const b = clone();
    b.scenarios[0].situation = `${b.scenarios[0].solution} ${b.scenarios[0].situation}`;
    expect(validatePlan(b).join(' ')).toMatch(/solution/i);
  });

  it('rejects a task that shows or repeats a solution, and a task that is no text', () => {
    const a = clone();
    a.scenarios[0].task = 'Eine erfundene Frage. Richtige Antwort: B';
    expect(validatePlan(a).join(' ')).toMatch(/task.*solution/i);
    const b = clone();
    b.scenarios[0].task = b.scenarios[0].solution;
    expect(validatePlan(b).join(' ')).toMatch(/task.*solution/i);
    const c = clone();
    c.scenarios[0].task = '  eine erfundene lösung omega.  ';
    expect(validatePlan(c).join(' ')).toMatch(/task.*solution/i);
    const d = clone();
    d.scenarios[0].task = 42 as unknown as string;
    expect(validatePlan(d).join(' ')).toMatch(/task/);
    const e = clone();
    e.scenarios[0].task = 'Eine erfundene Aufgabe TAU.';
    expect(validatePlan(e)).toEqual([]);
    const f = clone();
    f.scenarios[0].task = 'Eine erfundene Frage.\n\nErwartete Lösung';
    expect(validatePlan(f).join(' ')).toMatch(/task/i);
    const g = clone();
    g.scenarios[0].task = '   ';
    expect(validatePlan(g).join(' ')).toMatch(/task/);
  });
});

describe('renderPlanSummary', () => {
  it('lists numbers, skipped files and open questions, but no content', () => {
    const files = sampleTree().filter(
      f => !f.rel.endsWith('1a_Quiz_Medium.docx')
    );
    files.push(
      file(
        `${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Medium.docx`,
        quizContent({
          heading: '1a) Erfundenes Enabler-Thema',
          level: 'mittel',
          tag: 'bad',
          skipAnswerOf: 3,
        })
      )
    );
    const p = build(files);
    const text = renderPlanSummary(p);
    expect(text).toMatch(/Komponenten/);
    expect(text).toMatch(/quiz:1a:medium/);
    expect(text).toMatch(/Planned hours are placeholders/);
    expect(text).toMatch(/\| K6\.2 \| pflicht \| 2 \| 11 \|/);
    expect(text).toMatch(/\| K20 \| integrativ \| - \| 0 \|/);
    for (const secret of [
      'Erfundene Frage',
      'ZETA',
      'OMEGA',
      'SIGMA',
      'Erfundener Lehrtext',
      'Erfundene Lage',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
