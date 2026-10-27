/**
 * @jest-environment node
 */
import {
  checkAssignment,
  mergeAssignment,
  parseDecisionRequest,
  MAX_ITEMS,
  MAX_NOTE_CHARS,
} from '@/lib/content-upload/review/validate';
import { buildPositiveList } from '@/lib/content-upload/classify/positive-list';
import {
  databaseInput,
  decisionsPreset,
  groupOfComponent,
  optionsOf,
} from '@/lib/content-upload/review/service';
import { DB_COMPONENTS } from '../../../helpers/reviewFixtures';

const context = () => ({
  list: buildPositiveList(databaseInput(DB_COMPONENTS)),
  decisions: decisionsPreset(),
});
const docx = { ext: 'docx', dupKey: null };

describe('checkAssignment', () => {
  it('accepts a complete assignment on the list and returns the content key', () => {
    expect(
      checkAssignment(
        {
          docType: 'quiz',
          componentCode: 'K1',
          enablerCode: 'K1-a',
          quizLevel: 'medium',
        },
        docx,
        context()
      )
    ).toMatchObject({ ok: true, key: 'quiz:1a:medium' });
    expect(
      checkAssignment(
        {
          docType: 'scenario',
          componentCode: 'K6.1',
          enablerCode: 'K6.1-a',
          quizLevel: null,
        },
        docx,
        context()
      )
    ).toMatchObject({ ok: true, key: 'scenario:6.1a' });
  });

  it('takes a global quiz with a component and no enabler', () => {
    expect(
      checkAssignment(
        {
          docType: 'global_quiz',
          componentCode: 'K6.1',
          enablerCode: null,
          quizLevel: null,
        },
        docx,
        context()
      )
    ).toMatchObject({ ok: true, key: 'global-quiz:06.1' });
    expect(
      checkAssignment(
        {
          docType: 'global_quiz',
          componentCode: 'K6.1',
          enablerCode: 'K6.1-a',
          quizLevel: null,
        },
        docx,
        context()
      )
    ).toEqual({ ok: false, code: 'ASSIGNMENT_INVALID' });
  });

  it('binds a PDF to the type its content key names', () => {
    const pdf = { ext: 'pdf', dupKey: 'pdf:quiz:1a:low' };
    expect(
      checkAssignment(
        {
          docType: 'pdf_original',
          componentCode: 'K1',
          enablerCode: 'K1-a',
          quizLevel: 'low',
        },
        pdf,
        context()
      )
    ).toMatchObject({ ok: true, key: 'pdf:quiz:1a:low' });
    // a PDF whose type the rule stage never found cannot be accepted
    expect(
      checkAssignment(
        {
          docType: 'pdf_original',
          componentCode: 'K1',
          enablerCode: 'K1-a',
          quizLevel: null,
        },
        { ext: 'pdf', dupKey: null },
        context()
      )
    ).toEqual({ ok: false, code: 'ASSIGNMENT_INCOMPLETE' });
    // and a Word type does not fit a PDF
    expect(
      checkAssignment(
        {
          docType: 'enabler',
          componentCode: 'K1',
          enablerCode: 'K1-a',
          quizLevel: null,
        },
        pdf,
        context()
      )
    ).toEqual({ ok: false, code: 'TYPE_EXT_MISMATCH' });
  });

  it.each([
    [
      {
        docType: null,
        componentCode: 'K1',
        enablerCode: 'K1-a',
        quizLevel: null,
      },
      'ASSIGNMENT_INCOMPLETE',
    ],
    [
      {
        docType: 'quiz',
        componentCode: null,
        enablerCode: null,
        quizLevel: 'low',
      },
      'ASSIGNMENT_INCOMPLETE',
    ],
    [
      {
        docType: 'quiz',
        componentCode: 'K1',
        enablerCode: null,
        quizLevel: 'low',
      },
      'ASSIGNMENT_INCOMPLETE',
    ],
    [
      {
        docType: 'quiz',
        componentCode: 'K1',
        enablerCode: 'K1-a',
        quizLevel: null,
      },
      'LEVEL_INVALID',
    ],
    [
      {
        docType: 'quiz',
        componentCode: 'K1',
        enablerCode: 'K1-a',
        quizLevel: 'extreme',
      },
      'LEVEL_INVALID',
    ],
    [
      {
        docType: 'use_case',
        componentCode: 'K1',
        enablerCode: 'K1-a',
        quizLevel: 'low',
      },
      'LEVEL_INVALID',
    ],
    [
      {
        docType: 'quiz',
        componentCode: 'K77',
        enablerCode: 'K77-a',
        quizLevel: 'low',
      },
      'NOT_IN_POSITIVE_LIST',
    ],
    [
      {
        docType: 'quiz',
        componentCode: 'K1',
        enablerCode: 'K1-z',
        quizLevel: 'low',
      },
      'NOT_IN_POSITIVE_LIST',
    ],
    [
      {
        docType: 'quiz',
        componentCode: 'K1',
        enablerCode: 'K12-a',
        quizLevel: 'low',
      },
      'NOT_IN_POSITIVE_LIST',
    ],
    [
      {
        docType: 'other',
        componentCode: 'K1',
        enablerCode: 'K1-a',
        quizLevel: null,
      },
      'ASSIGNMENT_INCOMPLETE',
    ],
    [
      {
        docType: 'drop table',
        componentCode: 'K1',
        enablerCode: 'K1-a',
        quizLevel: null,
      },
      'ASSIGNMENT_INCOMPLETE',
    ],
  ])('refuses %j with %s', (assignment, code) => {
    expect(checkAssignment(assignment, docx, context())).toEqual({
      ok: false,
      code,
    });
  });

  it('refuses a component that the presets leave out of the import', () => {
    const ctx = context();
    const list = buildPositiveList(
      databaseInput([
        ...DB_COMPONENTS,
        {
          code: 'K18',
          title: null,
          kind: 'pflicht',
          phase: 2,
          enablers: [{ code: 'K18-a', title: null }],
        },
      ])
    );
    expect(
      checkAssignment(
        {
          docType: 'enabler',
          componentCode: 'K18',
          enablerCode: 'K18-a',
          quizLevel: null,
        },
        docx,
        { ...ctx, list }
      )
    ).toEqual({ ok: false, code: 'COMPONENT_EXCLUDED' });
  });

  it('refuses a component whose kind does not fit its part of the training', () => {
    const ctx = context();
    // K1 is mandatory but the database says elective
    const list = buildPositiveList(
      databaseInput([
        {
          code: 'K1',
          title: null,
          kind: 'wahl',
          phase: null,
          enablers: [{ code: 'K1-a', title: null }],
        },
      ])
    );
    expect(
      checkAssignment(
        {
          docType: 'enabler',
          componentCode: 'K1',
          enablerCode: 'K1-a',
          quizLevel: null,
        },
        docx,
        { ...ctx, list }
      )
    ).toEqual({ ok: false, code: 'KIND_GROUP_MISMATCH' });
  });
});

describe('mergeAssignment', () => {
  const base = {
    docType: 'quiz',
    componentCode: 'K1',
    enablerCode: 'K1-a',
    quizLevel: 'low',
  };

  it('keeps a field that is left out and clears one that is null', () => {
    expect(mergeAssignment(base, { enablerCode: 'K1-b' })).toEqual({
      ...base,
      enablerCode: 'K1-b',
    });
    expect(mergeAssignment(base, { quizLevel: null })).toEqual({
      ...base,
      quizLevel: null,
    });
    expect(mergeAssignment(base, {})).toEqual(base);
  });
});

describe('parseDecisionRequest', () => {
  const ID = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';
  const ID2 = '9b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e12';
  const parse = (body: unknown) => parseDecisionRequest(body);
  const bad = (body: unknown) =>
    expect(parse(body)).toMatchObject({
      ok: false,
      status: 400,
      code: 'BODY_INVALID',
    });

  it('reads every command', () => {
    expect(parse({ expectedVersion: 3, command: 'accept_high' })).toEqual({
      ok: true,
      data: { expectedVersion: 3, command: { command: 'accept_high' } },
    });
    expect(
      parse({ expectedVersion: 0, command: 'accept_newest' })
    ).toMatchObject({ ok: true });
    expect(
      parse({
        expectedVersion: 1,
        command: 'set',
        items: [
          {
            fileId: ID,
            action: 'accept',
            assignment: { componentCode: 'K1' },
            note: '  gut  ',
          },
          { fileId: ID2, action: 'defer' },
        ],
      })
    ).toEqual({
      ok: true,
      data: {
        expectedVersion: 1,
        command: {
          command: 'set',
          items: [
            {
              fileId: ID,
              action: 'accept',
              assignment: { componentCode: 'K1' },
              note: 'gut',
            },
            { fileId: ID2, action: 'defer', assignment: null, note: null },
          ],
        },
      },
    });
    expect(
      parse({
        expectedVersion: 1,
        command: 'bulk',
        action: 'reject',
        fileIds: [ID, ID, ID2],
      })
    ).toEqual({
      ok: true,
      data: {
        expectedVersion: 1,
        command: { command: 'bulk', action: 'reject', fileIds: [ID, ID2] },
      },
    });
    expect(
      parse({
        expectedVersion: 1,
        command: 'assign',
        fileIds: [ID],
        assignment: { docType: 'quiz', quizLevel: null },
      })
    ).toMatchObject({
      ok: true,
      data: {
        command: {
          command: 'assign',
          assignment: { docType: 'quiz', quizLevel: null },
        },
      },
    });
    expect(
      parse({
        expectedVersion: 1,
        command: 'duplicate',
        key: 'quiz:1a:low',
        keepFileId: ID,
      })
    ).toMatchObject({ ok: true });
    expect(
      parse({
        expectedVersion: 1,
        command: 'duplicate',
        key: 'pdf:global-quiz:06.1',
      })
    ).toMatchObject({
      ok: true,
      data: { command: { keepFileId: null } },
    });
  });

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['null', null],
    ['no version', { command: 'accept_high' }],
    ['a negative version', { expectedVersion: -1, command: 'accept_high' }],
    ['a fractional version', { expectedVersion: 1.5, command: 'accept_high' }],
    ['a version as text', { expectedVersion: '1', command: 'accept_high' }],
    ['an unknown command', { expectedVersion: 1, command: 'delete_all' }],
    ['no command', { expectedVersion: 1 }],
    ['set without items', { expectedVersion: 1, command: 'set' }],
    [
      'set with an empty list',
      { expectedVersion: 1, command: 'set', items: [] },
    ],
    [
      'set with a bad id',
      {
        expectedVersion: 1,
        command: 'set',
        items: [{ fileId: 'x', action: 'accept' }],
      },
    ],
    [
      'set with a bad action',
      {
        expectedVersion: 1,
        command: 'set',
        items: [{ fileId: ID, action: 'delete' }],
      },
    ],
    [
      'set with a file twice',
      {
        expectedVersion: 1,
        command: 'set',
        items: [
          { fileId: ID, action: 'defer' },
          { fileId: ID, action: 'reject' },
        ],
      },
    ],
    [
      'an assignment with reject',
      {
        expectedVersion: 1,
        command: 'set',
        items: [
          { fileId: ID, action: 'reject', assignment: { docType: 'quiz' } },
        ],
      },
    ],
    [
      'an assignment that is not an object',
      {
        expectedVersion: 1,
        command: 'set',
        items: [{ fileId: ID, action: 'accept', assignment: 'quiz' }],
      },
    ],
    [
      'an empty assignment',
      {
        expectedVersion: 1,
        command: 'set',
        items: [{ fileId: ID, action: 'accept', assignment: {} }],
      },
    ],
    [
      'a code with a quote',
      {
        expectedVersion: 1,
        command: 'assign',
        fileIds: [ID],
        assignment: { componentCode: "K1'; --" },
      },
    ],
    [
      'a code that is a number',
      {
        expectedVersion: 1,
        command: 'assign',
        fileIds: [ID],
        assignment: { enablerCode: 5 },
      },
    ],
    [
      'a note that is not text',
      {
        expectedVersion: 1,
        command: 'set',
        items: [{ fileId: ID, action: 'defer', note: 5 }],
      },
    ],
    [
      'bulk with accept',
      { expectedVersion: 1, command: 'bulk', action: 'accept', fileIds: [ID] },
    ],
    [
      'bulk without ids',
      { expectedVersion: 1, command: 'bulk', action: 'defer', fileIds: [] },
    ],
    [
      'bulk with a bad id',
      {
        expectedVersion: 1,
        command: 'bulk',
        action: 'defer',
        fileIds: [ID, 'nope'],
      },
    ],
    [
      'assign without an assignment',
      { expectedVersion: 1, command: 'assign', fileIds: [ID] },
    ],
    ['duplicate without a key', { expectedVersion: 1, command: 'duplicate' }],
    [
      'duplicate with a key full of symbols',
      { expectedVersion: 1, command: 'duplicate', key: "a b'c" },
    ],
    [
      'duplicate with a bad file id',
      {
        expectedVersion: 1,
        command: 'duplicate',
        key: 'quiz:1a:low',
        keepFileId: 'x',
      },
    ],
  ])('answers 400 for %s', (_name, body) => bad(body));

  it('limits the number of items and of ids', () => {
    const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({
      fileId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      action: 'defer',
    }));
    bad({ expectedVersion: 1, command: 'set', items: many });
    bad({
      expectedVersion: 1,
      command: 'bulk',
      action: 'defer',
      fileIds: many.map(m => m.fileId),
    });
  });

  it('cuts a note, replaces control characters and turns a blank note into none', () => {
    const long = parse({
      expectedVersion: 1,
      command: 'set',
      items: [
        { fileId: ID, action: 'defer', note: `a\u0000b${'x'.repeat(900)}` },
      ],
    });
    const note = (long as any).data.command.items[0].note as string;
    expect(note).toHaveLength(MAX_NOTE_CHARS);
    expect(note.startsWith('a b')).toBe(true);
    expect(
      (
        parse({
          expectedVersion: 1,
          command: 'set',
          items: [{ fileId: ID, action: 'defer', note: ' \n ' }],
        }) as any
      ).data.command.items[0].note
    ).toBeNull();
  });
});

describe('the options of the selects and the groups of the database', () => {
  it('derives the group of a component of the database from its kind and phase', () => {
    expect(
      groupOfComponent({
        code: 'K1',
        title: null,
        kind: 'pflicht',
        phase: 1,
        enablers: [],
      })
    ).toBe('teil1');
    expect(
      groupOfComponent({
        code: 'K7',
        title: null,
        kind: 'pflicht',
        phase: 2,
        enablers: [],
      })
    ).toBe('teil2');
    expect(
      groupOfComponent({
        code: 'K12',
        title: null,
        kind: 'wahl',
        phase: null,
        enablers: [],
      })
    ).toBe('wahl');
    expect(
      groupOfComponent({
        code: 'K20',
        title: null,
        kind: 'integrativ',
        phase: null,
        enablers: [],
      })
    ).toBe('ganze');
    expect(
      groupOfComponent({
        code: 'K3',
        title: null,
        kind: 'pflicht',
        phase: null,
        enablers: [],
      })
    ).toBeNull();
  });

  it('merges the database and the plan: the database wins, the plan is new', () => {
    const options = optionsOf(DB_COMPONENTS, {
      components: [
        {
          code: 'K1',
          origin: 'plan',
          enablers: [
            { code: 'K1-a', origin: 'plan' },
            { code: 'K1-d', origin: 'plan' },
          ],
        },
        {
          code: 'K9',
          title: 'Neu',
          origin: 'plan',
          enablers: [{ code: 'K9-a', origin: 'plan' }],
        },
      ],
    });
    expect(options.components.map(c => [c.code, c.isNew])).toEqual([
      ['K1', false],
      ['K6.1', false],
      ['K9', true],
      ['K12', false],
    ]);
    const k1 = options.components.find(c => c.code === 'K1')!;
    expect(k1.enablers.map(e => [e.code, e.isNew])).toEqual([
      ['K1-a', false],
      ['K1-b', false],
      ['K1-c', false],
      ['K1-d', true],
    ]);
  });
});
