/**
 * @jest-environment node
 */
// The positive list: the components and enablers that an assignment may name.
// It comes from the database and from the plan of the folder tree later, here
// it is an interface that the tests fill with a synthetic list.
import { describe, expect, it } from '@jest/globals';

import {
  buildPositiveList,
  positiveListFromPaths,
} from '@/lib/content-upload/classify/positive-list';

import {
  DIR,
  SMALL_LIST,
  paths,
  smallList,
} from '../../../helpers/classifyFixtures';

describe('buildPositiveList', () => {
  it('knows its components and enablers', () => {
    const list = smallList();
    expect(list.size).toEqual({ components: 7, enablers: 11 });
    expect(list.component('K6.2')).toMatchObject({
      code: 'K6.2',
      number: 6,
      split: 2,
      origin: 'database',
      group: 'teil2',
    });
    expect(list.enabler('K6.2-d')).toMatchObject({
      code: 'K6.2-d',
      componentCode: 'K6.2',
      letter: 'd',
      key: '6.2d',
    });
    expect(list.component('K99')).toBeNull();
    expect(list.enabler('K6.2-z')).toBeNull();
  });

  it('is not case sensitive for a code and ignores blanks around it', () => {
    const list = smallList();
    expect(list.component(' k6.2 ')?.code).toBe('K6.2');
    expect(list.enabler('K6.2-D')?.code).toBe('K6.2-d');
  });

  it('drops entries that are not codes of the plan and counts them', () => {
    const list = buildPositiveList({
      components: [
        {
          code: 'K1',
          enablers: [{ code: 'K1-a' }, { code: 'K2-b' }, { code: 'x' }],
        },
        { code: 'Komponente 3' },
        { code: "K4'; drop table" },
        { code: 'K5.12' },
        { code: 'K6', enablers: [{ code: 'K6-ab' }] },
      ],
    });
    expect(list.size).toEqual({ components: 2, enablers: 1 });
    expect(list.rejected).toBe(6);
    expect(list.component('K3')).toBeNull();
  });

  it('merges lists and lets the database win over the plan', () => {
    const list = buildPositiveList(
      {
        components: [
          {
            code: 'K1',
            origin: 'plan',
            enablers: [{ code: 'K1-a', origin: 'plan' }],
          },
          {
            code: 'K2',
            origin: 'plan',
            enablers: [{ code: 'K2-a', origin: 'plan' }],
          },
        ],
      },
      {
        components: [
          { code: 'K1', origin: 'database', enablers: [{ code: 'K1-b' }] },
        ],
      }
    );
    expect(list.component('K1')?.origin).toBe('database');
    expect(list.enabler('K1-a')?.origin).toBe('plan');
    expect(list.enabler('K1-b')?.origin).toBe('database');
    expect(list.component('K2')?.origin).toBe('plan');
    expect(list.size).toEqual({ components: 2, enablers: 3 });
  });

  it('an enabler of the plan makes its component known when only the enabler is new', () => {
    const list = buildPositiveList({
      components: [
        { code: 'K1', enablers: [{ code: 'K1-a', origin: 'plan' }] },
      ],
    });
    expect(list.component('K1')?.origin).toBe('database');
    expect(list.enabler('K1-a')?.origin).toBe('plan');
  });

  it('is bounded in size and says so', () => {
    const components = Array.from({ length: 600 }, (_, i) => ({
      code: `K${(i % 99) + 1}.${i % 10}`,
      enablers: [{ code: `K${(i % 99) + 1}.${i % 10}-a` }],
    }));
    const list = buildPositiveList({ components });
    expect(list.size.components).toBeLessThanOrEqual(500);
    expect(list.truncated).toBe(true);
  });

  it('does not change what it is given', () => {
    const before = JSON.stringify(SMALL_LIST);
    buildPositiveList(SMALL_LIST);
    expect(JSON.stringify(SMALL_LIST)).toBe(before);
  });

  it('survives odd input', () => {
    expect(buildPositiveList().size).toEqual({ components: 0, enablers: 0 });
    expect(
      buildPositiveList(
        null as never,
        { components: null } as never,
        {
          components: [null, 7, { code: 5 }, { code: 'K1', enablers: 'x' }],
        } as never
      ).size
    ).toEqual({ components: 1, enablers: 0 });
  });
});

describe('positive list: resolving a heading code', () => {
  const list = smallList();

  it('resolves a code with a split exactly', () => {
    expect(list.resolveEnablerKey('6.2d')).toEqual({
      status: 'unique',
      componentCode: 'K6.2',
      enablerCode: 'K6.2-d',
      origin: 'database',
    });
  });

  it('resolves a code without a split when only one component has the enabler', () => {
    expect(list.resolveEnablerKey('6e')).toMatchObject({
      status: 'unique',
      componentCode: 'K6.2',
      enablerCode: 'K6.2-e',
    });
    expect(list.resolveEnablerKey('1a')).toMatchObject({
      status: 'unique',
      enablerCode: 'K1-a',
    });
  });

  it('says ambiguous when two split components have the enabler', () => {
    const result = list.resolveEnablerKey('6d');
    expect(result).toMatchObject({ status: 'ambiguous' });
    expect(result.status === 'ambiguous' && result.candidates).toEqual([
      'K6.1-d',
      'K6.2-d',
    ]);
  });

  it('uses a hint to choose between split components', () => {
    expect(list.resolveEnablerKey('6d', 'K6.2')).toMatchObject({
      status: 'unique',
      enablerCode: 'K6.2-d',
    });
    expect(list.resolveEnablerKey('6d', 'K6.1')).toMatchObject({
      enablerCode: 'K6.1-d',
    });
  });

  it('says missing for an enabler that is not on the list', () => {
    expect(list.resolveEnablerKey('9z')).toEqual({ status: 'missing' });
    expect(list.resolveEnablerKey('6.3d')).toEqual({ status: 'missing' });
    expect(list.resolveEnablerKey('not a key')).toEqual({ status: 'missing' });
    expect(list.resolveEnablerKey('')).toEqual({ status: 'missing' });
  });

  it('resolves the component of a global quiz', () => {
    expect(list.resolveComponentKey('06.1')).toMatchObject({
      status: 'unique',
      componentCode: 'K6.1',
    });
    expect(list.resolveComponentKey('01')).toMatchObject({
      status: 'unique',
      componentCode: 'K1',
    });
    expect(list.resolveComponentKey('06')).toMatchObject({
      status: 'ambiguous',
    });
    expect(list.resolveComponentKey('99')).toEqual({ status: 'missing' });
  });
});

describe('positiveListFromPaths: what the plan of a folder tree would add', () => {
  it('lists the components and enablers of the folders, marked as plan', () => {
    const input = positiveListFromPaths([
      paths.quiz(DIR.k1, '1a', 'Low'),
      paths.enabler(DIR.k1, '1b'),
      paths.scenario(DIR.k6_2, '6d'),
      paths.globalQuiz(DIR.k10, '10'),
      'loose file.docx',
    ]);
    const list = buildPositiveList(input);
    expect(list.size).toEqual({ components: 3, enablers: 3 });
    expect(list.component('K6.2')).toMatchObject({
      origin: 'plan',
      group: 'teil2',
    });
    expect(list.component('K10')).toMatchObject({ group: 'wahl' });
    expect(list.enabler('K6.2-d')?.origin).toBe('plan');
  });

  it('skips archives and paths without structure', () => {
    const input = positiveListFromPaths([
      `${DIR.k1}/Enablers/1a_Thema/Enabler_Archiv_to_delete/1a.docx`,
      '1a_Quiz_Low.docx',
      '',
    ]);
    expect(input.components).toEqual([]);
  });

  it('is sorted and does not depend on the order of the paths', () => {
    const a = positiveListFromPaths([
      paths.enabler(DIR.k6_2, '6d'),
      paths.enabler(DIR.k1, '1b'),
    ]);
    const b = positiveListFromPaths([
      paths.enabler(DIR.k1, '1b'),
      paths.enabler(DIR.k6_2, '6d'),
    ]);
    expect(a).toEqual(b);
  });
});
