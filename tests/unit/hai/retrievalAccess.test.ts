/**
 * @jest-environment node
 */

// resolveRetrievalAccess (package H1): catalogs, audience and organization of
// a user, derived from the database only, fail closed.

const mockProfileRows = jest.fn();
const mockScope = jest.fn();

jest.mock('@/db', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => mockProfileRows();
  return { __esModule: true, default: chain };
});
jest.mock('@/lib/db-retry', () => ({
  withDbRetry: (fn: () => unknown) => fn(),
}));
jest.mock('@/lib/catalog/scope', () => ({
  getCatalogScopeForUserId: (userId: string) => mockScope(userId),
  readCatalogIds: (scope: {
    selected: boolean;
    activeCatalogId: string;
    allowedCatalogIds: string[];
  }) => (scope.selected ? [scope.activeCatalogId] : scope.allowedCatalogIds),
}));

import { resolveRetrievalAccess } from '@/lib/hai/retrievalAccess';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const USER = '10000000-0000-4000-8000-000000000001';

const scopeOf = (ids: string[], selected = false) => ({
  allowedCatalogIds: ids,
  activeCatalogId: ids[0],
  selected,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockProfileRows.mockResolvedValue([{ role: 'TRAINEE', organizationId: ORG }]);
  mockScope.mockResolvedValue(scopeOf([FIAE]));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('resolveRetrievalAccess', () => {
  it('gives a trainee the catalog of the scope and the trainee audience', async () => {
    mockScope.mockResolvedValue(scopeOf([KFBM]));
    expect(await resolveRetrievalAccess(USER)).toEqual({
      catalogIds: [KFBM],
      audience: 'trainee',
      organizationId: ORG,
      userId: USER,
    });
    expect(mockScope).toHaveBeenCalledWith(USER);
  });

  it.each(['TRAINER', 'TEMP_ADMIN', 'ADMIN', 'SUPER_ADMIN', 'trainer'])(
    'gives the role %s the trainer audience',
    async role => {
      mockProfileRows.mockResolvedValue([{ role, organizationId: ORG }]);
      const access = await resolveRetrievalAccess(USER);
      expect(access?.audience).toBe('trainer');
    }
  );

  it.each([null, '', 'UNKNOWN'])(
    'treats the role %p as a trainee (never trainer level by accident)',
    async role => {
      mockProfileRows.mockResolvedValue([{ role, organizationId: ORG }]);
      const access = await resolveRetrievalAccess(USER);
      expect(access?.audience).toBe('trainee');
    }
  );

  it('passes all catalogs of a trainer and an empty organization as null', async () => {
    mockProfileRows.mockResolvedValue([
      { role: 'TRAINER', organizationId: null },
    ]);
    mockScope.mockResolvedValue(scopeOf([FIAE, KFBM]));
    const access = await resolveRetrievalAccess(USER);
    expect(access?.catalogIds).toEqual([FIAE, KFBM]);
    expect(access?.organizationId).toBeNull();
  });

  it('narrows to the chosen catalog when the scope has a selection', async () => {
    mockScope.mockResolvedValue({
      allowedCatalogIds: [FIAE, KFBM],
      activeCatalogId: KFBM,
      selected: true,
    });
    expect((await resolveRetrievalAccess(USER))?.catalogIds).toEqual([KFBM]);
  });

  it('is null for an empty user id without touching the database', async () => {
    expect(await resolveRetrievalAccess('')).toBeNull();
    expect(mockProfileRows).not.toHaveBeenCalled();
  });

  it('is null for an unknown profile (fail closed)', async () => {
    mockProfileRows.mockResolvedValue([]);
    expect(await resolveRetrievalAccess(USER)).toBeNull();
    expect(mockScope).not.toHaveBeenCalled();
  });

  it('is null when the catalog scope cannot be determined (fail closed)', async () => {
    mockScope.mockResolvedValue(null);
    expect(await resolveRetrievalAccess(USER)).toBeNull();
  });

  it('is null when the scope has no catalog', async () => {
    mockScope.mockResolvedValue(scopeOf([]));
    expect(await resolveRetrievalAccess(USER)).toBeNull();
  });

  it('is null when the database fails', async () => {
    mockProfileRows.mockRejectedValue(new Error('db down'));
    expect(await resolveRetrievalAccess(USER)).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
