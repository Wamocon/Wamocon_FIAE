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
  CATALOG_HEADER: 'x-catalog',
  getCatalogScopeForUserId: (...args: unknown[]) => mockScope(...args),
  readCatalogIds: (scope: {
    selected: boolean;
    activeCatalogId: string;
    allowedCatalogIds: string[];
  }) => (scope.selected ? [scope.activeCatalogId] : scope.allowedCatalogIds),
}));

import {
  resolveCatalogChoice,
  resolveRetrievalAccess,
} from '@/lib/hai/retrievalAccess';

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

// ============================================================================
// The occupation chosen in the app (header x-catalog) limits the HAI to that
// one occupation, like the routes of the platform and the quiz mode. The scope
// itself decides which code is valid (getCatalogScopeForUserId with the
// header), so chat and quiz mode cannot drift apart.
// ============================================================================

describe('the chosen occupation', () => {
  const BOTH = [FIAE, KFBM];
  /** The scope as the catalog module answers it: a code of the user narrows, another is a 403 (null). */
  const scopeByCode = (
    userId: string,
    request?: { headers: Headers }
  ): Promise<ReturnType<typeof scopeOf> | null> => {
    const code = request?.headers.get('x-catalog')?.toLowerCase();
    if (!code) return Promise.resolve(scopeOf(BOTH));
    const id = ({ fiae: FIAE, kfbm: KFBM } as Record<string, string>)[code];
    return Promise.resolve(
      id && BOTH.includes(id)
        ? { allowedCatalogIds: BOTH, activeCatalogId: id, selected: true }
        : null
    );
  };

  beforeEach(() => mockScope.mockImplementation(scopeByCode));

  it.each([
    ['FIAE', FIAE],
    ['KFBM', KFBM],
    [' kfbm ', KFBM],
  ])(
    'with the code %p the HAI reads only that occupation',
    async (code, id) => {
      const access = await resolveRetrievalAccess(USER, code);
      expect(access?.catalogIds).toEqual([id]);
      // the full list stays next to it, for the persona (the other own occupation)
      expect(access?.allowedCatalogIds).toEqual(BOTH);
      expect(access?.audience).toBe('trainee');
      expect(access?.userId).toBe(USER);
    }
  );

  it('without a code (or an empty one) the user keeps all occupations, as before', async () => {
    for (const code of [undefined, null, '', '  ']) {
      const access = await resolveRetrievalAccess(USER, code);
      expect(access?.catalogIds).toEqual(BOTH);
      expect(access?.allowedCatalogIds).toBeUndefined();
    }
  });

  it('ignores a code that is not an occupation of the user: no 403, nothing lost, nothing gained', async () => {
    const access = await resolveRetrievalAccess(USER, 'DEMO');
    expect(access?.catalogIds).toEqual(BOTH);
    expect(access?.allowedCatalogIds).toBeUndefined();
    // a user with KfBM only who sends FIAE reads KfBM only
    mockScope.mockImplementation(
      (userId: string, request?: { headers: Headers }) =>
        request ? Promise.resolve(null) : Promise.resolve(scopeOf([KFBM]))
    );
    const only = await resolveRetrievalAccess(USER, 'FIAE');
    expect(only?.catalogIds).toEqual([KFBM]);
  });

  it('a user with one occupation who sends its code gets the same access as without', async () => {
    mockScope.mockImplementation(
      (userId: string, request?: { headers: Headers }) =>
        Promise.resolve(
          request
            ? {
                allowedCatalogIds: [FIAE],
                activeCatalogId: FIAE,
                selected: true,
              }
            : scopeOf([FIAE])
        )
    );
    expect(await resolveRetrievalAccess(USER, 'FIAE')).toEqual(
      await resolveRetrievalAccess(USER)
    );
  });

  it('asks the scope with the header of the code (the rule of the routes and the quiz mode)', async () => {
    await resolveRetrievalAccess(USER, 'KFBM');
    const [, request] = mockScope.mock.calls[0];
    expect((request as { headers: Headers }).headers.get('x-catalog')).toBe(
      'KFBM'
    );
  });

  it('fails closed when the scope cannot be determined, with or without a code', async () => {
    mockScope.mockResolvedValue(null);
    expect(await resolveRetrievalAccess(USER, 'FIAE')).toBeNull();
    expect(await resolveRetrievalAccess(USER)).toBeNull();
    expect(await resolveCatalogChoice(USER, 'FIAE')).toBeNull();
  });

  it('gives the occupations of a trainer scope the same way', async () => {
    mockProfileRows.mockResolvedValue([
      { role: 'TRAINER', organizationId: ORG },
    ]);
    const access = await resolveRetrievalAccess(USER, 'KFBM');
    expect(access?.audience).toBe('trainer');
    expect(access?.catalogIds).toEqual([KFBM]);
  });

  it('the choice for the titles of the chat route is the same list', async () => {
    expect(await resolveCatalogChoice(USER, 'FIAE')).toEqual({
      catalogIds: [FIAE],
      allowedCatalogIds: BOTH,
      chosen: true,
    });
    expect(await resolveCatalogChoice(USER, 'unknown')).toEqual({
      catalogIds: BOTH,
      allowedCatalogIds: BOTH,
      chosen: false,
    });
  });
});
