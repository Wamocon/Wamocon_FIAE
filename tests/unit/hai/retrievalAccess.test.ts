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

// Trainer solutions (model solutions of the private bucket): the permission is
// derived from the role in the database and the switch of the server, nothing
// else. The default is off.
describe('resolveRetrievalAccess: trainer solutions', () => {
  const saved = process.env.HAI_TRAINER_SOLUTIONS;
  afterEach(() => {
    if (saved === undefined) delete process.env.HAI_TRAINER_SOLUTIONS;
    else process.env.HAI_TRAINER_SOLUTIONS = saved;
  });

  it('gives nobody the permission while the switch is off (the default)', async () => {
    delete process.env.HAI_TRAINER_SOLUTIONS;
    for (const role of ['TRAINEE', 'TRAINER', 'ADMIN', 'SUPER_ADMIN']) {
      mockProfileRows.mockResolvedValue([{ role, organizationId: ORG }]);
      const access = await resolveRetrievalAccess(USER);
      expect(access?.includeTrainerSolutions).toBeUndefined();
    }
  });

  it.each(['true', '1', 'yes', 'off', ''])(
    'gives nobody the permission for the value %p (only "on" counts)',
    async value => {
      process.env.HAI_TRAINER_SOLUTIONS = value;
      mockProfileRows.mockResolvedValue([
        { role: 'TRAINER', organizationId: ORG },
      ]);
      const access = await resolveRetrievalAccess(USER);
      expect(access?.includeTrainerSolutions).toBeUndefined();
    }
  );

  it.each(['TRAINER', 'TEMP_ADMIN', 'ADMIN', 'SUPER_ADMIN'])(
    'gives the role %s the permission with the switch on',
    async role => {
      process.env.HAI_TRAINER_SOLUTIONS = 'on';
      mockProfileRows.mockResolvedValue([{ role, organizationId: ORG }]);
      const access = await resolveRetrievalAccess(USER);
      expect(access).toMatchObject({
        audience: 'trainer',
        includeTrainerSolutions: true,
      });
    }
  );

  it.each(['TRAINEE', null, '', 'UNKNOWN'])(
    'never gives the role %p the permission, with the switch on',
    async role => {
      process.env.HAI_TRAINER_SOLUTIONS = 'on';
      mockProfileRows.mockResolvedValue([{ role, organizationId: ORG }]);
      const access = await resolveRetrievalAccess(USER);
      expect(access?.audience).toBe('trainee');
      expect(access?.includeTrainerSolutions).toBeUndefined();
    }
  );

  it('keeps the catalogs of the trainer: the permission opens no other occupation', async () => {
    process.env.HAI_TRAINER_SOLUTIONS = 'on';
    mockProfileRows.mockResolvedValue([
      { role: 'TRAINER', organizationId: ORG },
    ]);
    mockScope.mockResolvedValue(scopeOf([FIAE]));
    const access = await resolveRetrievalAccess(USER);
    expect(access?.catalogIds).toEqual([FIAE]);
    expect(access?.includeTrainerSolutions).toBe(true);
  });
});
