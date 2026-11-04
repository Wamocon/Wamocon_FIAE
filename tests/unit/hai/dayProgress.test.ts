/**
 * @jest-environment node
 */

// Progress and next step per occupation for the day companion. The occupations
// are read side by side (they do not depend on each other); the result must be
// what the sequential loop gave: the order of the catalogs (the chosen one
// first), an empty occupation skipped, a failed one named by `failed` while the
// others stay.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const USER = '10000000-0000-4000-8000-000000000001';

jest.mock('@/db', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/catalog/scope', () => ({
  getCatalogScopeForUserId: jest.fn(),
}));
jest.mock('@/lib/hai/navigation/data', () => ({
  loadNextStepEntries: jest.fn(),
}));

import db from '@/db';
import { getCatalogScopeForUserId } from '@/lib/catalog/scope';
import { loadNextStepEntries } from '@/lib/hai/navigation/data';
import { loadDayProgress } from '@/lib/hai/dayProgress';

const entry = (id: string, completed: boolean, order: number) => ({
  enablerId: id,
  title: `Enabler ${id}`,
  courseTitle: 'Kurs',
  stage: 1,
  chapter: 1,
  orderIndex: order,
  completed,
  locked: false,
});

let events: string[];

function install(byCatalog: Record<string, () => Promise<unknown[]>>) {
  (getCatalogScopeForUserId as jest.Mock).mockResolvedValue({
    allowedCatalogIds: [FIAE, KFBM],
    activeCatalogId: FIAE,
    selected: false,
  });
  (db as unknown as Record<string, unknown>).select = jest.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve([
        { id: FIAE, code: 'FIAE', title: 'Fachinformatiker' },
        { id: KFBM, code: 'KFBM', title: 'Büromanagement' },
      ]);
    return chain;
  });
  (loadNextStepEntries as jest.Mock).mockImplementation(
    async (_user: string, catalogs: string[]) => {
      events.push(`start ${catalogs[0]}`);
      const rows = await byCatalog[catalogs[0]]();
      events.push(`end ${catalogs[0]}`);
      return rows;
    }
  );
}

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(() => {
  jest.clearAllMocks();
  events = [];
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('loadDayProgress', () => {
  it('counts completed enablers per occupation and names the next step', async () => {
    install({
      [FIAE]: async () => [entry('a', true, 1), entry('b', false, 2)],
      [KFBM]: async () => [entry('c', false, 1)],
    });
    const day = await loadDayProgress(USER);
    expect(day.failed).toBe(false);
    expect(
      day.occupations.map(o => [
        o.code,
        o.completedEnablers,
        o.totalEnablers,
        o.progressPercent,
      ])
    ).toEqual([
      ['FIAE', 1, 2, 50],
      ['KFBM', 0, 1, 0],
    ]);
    expect(day.occupations[0].nextStep).toMatchObject({ kind: 'next' });
  });

  it('reads the occupations side by side and still returns them in the order of the catalogs', async () => {
    install({
      // the first occupation answers LATER than the second
      [FIAE]: async () => {
        await tick(30);
        return [entry('a', false, 1)];
      },
      [KFBM]: async () => {
        await tick(5);
        return [entry('c', true, 1)];
      },
    });
    const day = await loadDayProgress(USER);
    expect(events.slice(0, 2)).toEqual([`start ${FIAE}`, `start ${KFBM}`]);
    expect(events.indexOf(`start ${KFBM}`)).toBeLessThan(
      events.indexOf(`end ${FIAE}`)
    );
    expect(day.occupations.map(o => o.code)).toEqual(['FIAE', 'KFBM']);
  });

  it('puts the chosen occupation first', async () => {
    install({
      [FIAE]: async () => [entry('a', false, 1)],
      [KFBM]: async () => [entry('c', false, 1)],
    });
    const day = await loadDayProgress(USER, { preferredCatalogCode: 'kfbm' });
    expect(day.occupations.map(o => o.code)).toEqual(['KFBM', 'FIAE']);
  });

  it('skips an occupation without enablers', async () => {
    install({
      [FIAE]: async () => [],
      [KFBM]: async () => [entry('c', true, 1)],
    });
    const day = await loadDayProgress(USER);
    expect(day.occupations.map(o => o.code)).toEqual(['KFBM']);
    expect(day.failed).toBe(false);
  });

  it('a failed occupation sets failed and does not take the other one down', async () => {
    install({
      [FIAE]: async () => {
        throw new Error('db down');
      },
      [KFBM]: async () => [entry('c', true, 1)],
    });
    const day = await loadDayProgress(USER);
    expect(day.failed).toBe(true);
    expect(day.occupations.map(o => o.code)).toEqual(['KFBM']);
  });

  it('is empty and not failed without a catalog scope (fail closed)', async () => {
    install({});
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue(null);
    await expect(loadDayProgress(USER)).resolves.toEqual({
      occupations: [],
      failed: false,
    });
    expect(loadNextStepEntries).not.toHaveBeenCalled();
  });
});
