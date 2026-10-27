import {
  pathInfoFromAssignment,
  sameContentInfo,
  type Assignment,
  type AssignmentDocType,
} from '@/lib/content-import/apply/path-from-assignment';
import { pathInfo } from '@/lib/content-import/path-info';
import type { PathInfo } from '@/lib/content-import/types';

import { DIR } from './fixtures';

const TYPE_TO_DOC: Record<string, AssignmentDocType> = {
  enabler: 'enabler',
  quiz: 'quiz',
  'global-quiz': 'global_quiz',
  scenario: 'scenario',
  'use-case': 'use_case',
};

/** The decision a person would make for a file at this place of the tree. */
function assignmentOf(info: PathInfo): Assignment {
  return {
    docType: TYPE_TO_DOC[info.type],
    componentCode: info.component!.code,
    enablerCode: info.enablerCode,
    quizLevel: info.difficulty,
    format: info.format,
    version: info.version,
    component: {
      title: info.component!.title,
      reference: info.component!.paragraph,
      group: info.group,
    },
  };
}

const K24 =
  'Komponente - während der gesamten Ausbildung/24.1 - Erfundenes Teil (§ 4 Abs. 4 Nr. 5)';
const PATHS = [
  // enabler text, quizzes of all levels, scenario, use case, global quiz, per kind of component
  `${DIR.k1}/Enablers/1a_Thema/1a.docx`,
  `${DIR.k1}/Enablers/1b_Thema/Quiz/1b_Quiz_Low.docx`,
  `${DIR.k1}/Enablers/1b_Thema/Quiz/1b_Quiz_Medium.docx`,
  `${DIR.k1}/Enablers/1b_Thema/Quiz/1b_Quiz_High_v2.docx`,
  `${DIR.k1}/Enablers/1a_Thema/Szenario/Szenario_1a.docx`,
  `${DIR.k1}/K1_Use-Cases/UC_1a.docx`,
  `${DIR.k1}/Global Quiz/01_Global_Quiz_Thema.docx`,
  // a split component of the first and of the second part
  `${DIR.k6_1}/Enablers/6a_Thema/6a.docx`,
  `${DIR.k6_2}/Enablers/6.2d_Thema/Quiz/6.2d_Quiz_Low.docx`,
  `${DIR.k6_2}/K6.2_Use-Cases/UC_6.2d.docx`,
  `${DIR.k6_2}/Global Quiz/06.2_Global_Quiz_Thema.docx`,
  // elective (folder of part 2, group wahl) and integrative
  `${DIR.k10}/Enablers/10a_Thema/10a.docx`,
  `${DIR.k20}/Enablers/20a_Thema/Szenario/Szenario_20a.docx`,
  `${DIR.k20}/Global Quiz/20_Global_Quiz_Thema.docx`,
  `${K24}/Enablers/24.1a_Thema/24.1a.docx`,
];

describe('pathInfoFromAssignment', () => {
  it.each(PATHS)('gives the PathInfo of the path for %s', path => {
    const real = pathInfo(path);
    expect(real.issues).toEqual([]);
    const made = pathInfoFromAssignment(assignmentOf(real));
    expect(made.issues).toEqual([]);
    expect(made).toEqual({
      ...real,
      // what only a real folder tree can tell: nothing else differs
      flags: made.flags,
    });
    expect(sameContentInfo(real, made)).toBe(true);
  });

  it('knows the version and flags it like the path does', () => {
    const made = pathInfoFromAssignment({
      docType: 'quiz',
      componentCode: 'K1',
      enablerCode: 'K1-b',
      quizLevel: 'high',
      format: 'docx',
      version: 2,
      component: { title: 'T', reference: null, group: 'teil1' },
    });
    expect(made.version).toBe(2);
    expect(made.flags).toEqual(['version']);
  });

  it('puts an elective component into the group wahl and the folder of part 2', () => {
    const made = pathInfoFromAssignment({
      docType: 'enabler',
      componentCode: 'K12',
      enablerCode: 'K12-a',
      quizLevel: null,
      format: 'docx',
      component: { title: 'T', reference: null, group: 'wahl' },
    });
    expect(made).toMatchObject({ group: 'wahl', folderGroup: 'teil2' });
    expect(made.component).toMatchObject({ elective: true, excluded: false });
  });

  it('marks K18 as excluded, as the path does', () => {
    const made = pathInfoFromAssignment({
      docType: 'enabler',
      componentCode: 'K18',
      enablerCode: 'K18-a',
      quizLevel: null,
      format: 'docx',
    });
    expect(made.component?.excluded).toBe(true);
  });

  it('without facts of the component it names no group and no title (the planner then skips it)', () => {
    const made = pathInfoFromAssignment({
      docType: 'enabler',
      componentCode: 'K4',
      enablerCode: 'K4-a',
      quizLevel: null,
      format: 'docx',
    });
    expect(made.group).toBeNull();
    expect(made.folderGroup).toBeNull();
    expect(made.component).toMatchObject({ title: null, paragraph: null });
    expect(made.issues).toEqual([]);
  });

  it('ignores the folder group of the global quizzes', () => {
    const made = pathInfoFromAssignment({
      docType: 'global_quiz',
      componentCode: 'K1',
      enablerCode: null,
      quizLevel: null,
      format: 'docx',
      component: { title: 'T', reference: null, group: 'global' },
    });
    expect(made.group).toBeNull();
    expect(made.key).toBe('global-quiz:01');
  });

  const base: Assignment = {
    docType: 'quiz',
    componentCode: 'K4',
    enablerCode: 'K4-a',
    quizLevel: 'low',
    format: 'docx',
  };

  it.each([
    [
      'a component code that is none',
      { componentCode: 'Kx' },
      'component-code-invalid',
    ],
    [
      'an empty component code',
      { componentCode: '' },
      'component-code-invalid',
    ],
    [
      'an enabler code that is none',
      { enablerCode: 'K4' },
      'enabler-code-invalid',
    ],
    ['no enabler code', { enablerCode: null }, 'enabler-code-invalid'],
    [
      'an enabler of another component',
      { enablerCode: 'K5-a' },
      'component-mismatch',
    ],
    ['a quiz without a level', { quizLevel: null }, 'quiz-level-missing'],
    ['another format than docx', { format: 'pdf' }, 'unexpected-format'],
    [
      'a document type that is none',
      { docType: 'other' as unknown as AssignmentDocType },
      'unexpected-type',
    ],
  ] as Array<[string, Partial<Assignment>, string]>)(
    'reports %s as an issue and never guesses',
    (_name, patch, issue) => {
      const made = pathInfoFromAssignment({ ...base, ...patch });
      expect(made.issues).toContain(issue);
      if (issue !== 'unexpected-format') expect(made.key).toBeNull();
    }
  );

  it('never throws, whatever it is given', () => {
    for (const bad of [
      { ...base, componentCode: undefined as unknown as string },
      { ...base, format: undefined as unknown as string },
      { ...base, version: -1 },
      { ...base, version: Number.NaN },
    ]) {
      expect(() => pathInfoFromAssignment(bad)).not.toThrow();
    }
  });

  it('sameContentInfo tells two different contents apart', () => {
    const a = pathInfo(`${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Low.docx`);
    const b = pathInfo(`${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_High.docx`);
    expect(sameContentInfo(a, a)).toBe(true);
    expect(sameContentInfo(a, b)).toBe(false);
    expect(sameContentInfo(pathInfo('x.docx'), pathInfo('x.docx'))).toBe(false);
  });
});
