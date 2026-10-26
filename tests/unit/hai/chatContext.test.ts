/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';

// The enabler and course id of the chat client are checked against the
// catalog scope of the person before they reach the prompt, the search or the
// stored session.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ENABLER_FIAE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENABLER_KFBM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COURSE_FIAE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COURSE_KFBM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

async function load(options: {
  scope: { allowedCatalogIds: string[] } | null;
  enablerCatalog?: string | null;
  courseCatalog?: string | null;
  failScope?: boolean;
}) {
  jest.resetModules();
  const main = createTableDb({
    enablers:
      options.enablerCatalog === null
        ? []
        : [{ trainingCatalogId: options.enablerCatalog ?? FIAE }],
    courses:
      options.courseCatalog === null
        ? []
        : [{ trainingCatalogId: options.courseCatalog ?? FIAE }],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: main.db }));
  const getScope = jest.fn(async (_userId: string) => {
    if (options.failScope) throw new Error('db down');
    return options.scope;
  });
  jest.doMock('@/lib/catalog/scope', () => ({
    __esModule: true,
    getCatalogScopeForUserId: getScope,
    isCatalogAllowed: (
      scope: { allowedCatalogIds: string[] },
      catalogId: string | null | undefined
    ) => !!catalogId && scope.allowedCatalogIds.includes(String(catalogId)),
  }));
  const { verifyChatContextIds } = await import('@/lib/hai/chatContext');
  return { verifyChatContextIds, getScope, main };
}

describe('verifyChatContextIds', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('keeps an enabler and a course of the own occupation', async () => {
    const { verifyChatContextIds, getScope } = await load({
      scope: { allowedCatalogIds: [FIAE] },
    });
    await expect(
      verifyChatContextIds('u1', {
        enablerId: ENABLER_FIAE,
        courseId: COURSE_FIAE,
      })
    ).resolves.toEqual({ enablerId: ENABLER_FIAE, courseId: COURSE_FIAE });
    expect(getScope).toHaveBeenCalledWith('u1');
  });

  it('ignores an enabler and a course of another occupation', async () => {
    const { verifyChatContextIds } = await load({
      scope: { allowedCatalogIds: [FIAE] },
      enablerCatalog: KFBM,
      courseCatalog: KFBM,
    });
    await expect(
      verifyChatContextIds('u1', {
        enablerId: ENABLER_KFBM,
        courseId: COURSE_KFBM,
      })
    ).resolves.toEqual({});
  });

  it('checks both ids on their own', async () => {
    const { verifyChatContextIds } = await load({
      scope: { allowedCatalogIds: [FIAE] },
      enablerCatalog: KFBM,
      courseCatalog: FIAE,
    });
    await expect(
      verifyChatContextIds('u1', {
        enablerId: ENABLER_KFBM,
        courseId: COURSE_FIAE,
      })
    ).resolves.toEqual({ courseId: COURSE_FIAE });
  });

  it('ignores ids that do not exist', async () => {
    const { verifyChatContextIds } = await load({
      scope: { allowedCatalogIds: [FIAE] },
      enablerCatalog: null,
      courseCatalog: null,
    });
    await expect(
      verifyChatContextIds('u1', {
        enablerId: ENABLER_FIAE,
        courseId: COURSE_FIAE,
      })
    ).resolves.toEqual({});
  });

  it('ignores anything that is not a uuid without a lookup', async () => {
    const { verifyChatContextIds, getScope, main } = await load({
      scope: { allowedCatalogIds: [FIAE] },
    });
    await expect(
      verifyChatContextIds('u1', {
        enablerId: "1' OR '1'='1",
        courseId: 42,
      })
    ).resolves.toEqual({});
    await expect(verifyChatContextIds('u1', undefined)).resolves.toEqual({});
    await expect(verifyChatContextIds('u1', null)).resolves.toEqual({});
    expect(getScope).not.toHaveBeenCalled();
    expect(main.calls).toHaveLength(0);
  });

  it('keeps no id when the scope of the person cannot be determined (fail closed)', async () => {
    const { verifyChatContextIds } = await load({ scope: null });
    await expect(
      verifyChatContextIds('u1', { enablerId: ENABLER_FIAE })
    ).resolves.toEqual({});
  });

  it('keeps no id when the lookup fails (fail closed)', async () => {
    const { verifyChatContextIds } = await load({
      scope: null,
      failScope: true,
    });
    await expect(
      verifyChatContextIds('u1', { courseId: COURSE_FIAE })
    ).resolves.toEqual({});
  });
});

describe('chat route', () => {
  it('only hands the verified ids to the session, the titles and the pipeline', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src', 'app', 'api', 'hai', 'chat', 'route.ts'),
      'utf-8'
    );
    expect(route).toMatch(/verifyChatContextIds\(userId, context\)/);
    expect(route).toMatch(/currentEnablerId: verified\.enablerId/);
    expect(route).toMatch(/currentCourseId: verified\.courseId/);
    expect(route).not.toMatch(/currentEnablerId: context\?\.enablerId/);
    expect(route).not.toMatch(/getContextTitles\(\s*context\?\./);
    expect(route).not.toMatch(/const contextId = context\?\./);
  });
});
