/**
 * @jest-environment node
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { createTableDb } from '../../helpers/mockDb';

// HAI context per occupation (Jira WMCNL-2810, step 3.8). The pieces are tested one by one
// elsewhere with a fake scope (retrievalAccess, vectorSearch.scope, personaAccess). Here the
// chain runs with the REAL catalog scope against a table mock of one organization that has
// both occupations enabled: a FIAE trainee and a KfBM trainee each get the index filter, the
// persona and the live data of their own occupation only.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const USER = '10000000-0000-4000-8000-000000000001';

const dialect = new PgDialect();

async function load(occupation: string) {
  jest.resetModules();
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    verifyPlatformOwner: async () => true,
    getUserOrgId: async () => ORG,
    toHaiRole: () => 'TRAINEE',
  }));
  const mock = createTableDb({
    trainingCatalogs: [
      { id: FIAE, code: 'FIAE', isActive: true },
      { id: KFBM, code: 'KFBM', isActive: true },
    ],
    profiles: [
      {
        id: USER,
        role: 'TRAINEE',
        organizationId: ORG,
        isPlatformOwner: false,
      },
    ],
    organizationCatalogs: [
      { trainingCatalogId: FIAE, isEnabled: true },
      { trainingCatalogId: KFBM, isEnabled: true },
    ],
    traineeEnrollments: [
      { trainingCatalogId: occupation, startDate: '2026-08-01' },
    ],
    courseMembers: [],
    courses: [],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  // the search and the persona only need the rendered condition, no embedding service
  jest.doMock('@/db/haiDb', () => ({
    __esModule: true,
    default: { execute: jest.fn() },
  }));
  const access = await import('@/lib/hai/retrievalAccess');
  const search = await import('@/lib/hai/vectorSearch');
  const data = await import('@/lib/hai/dataContext');
  return { mock, access, search, data };
}

describe.each([
  { name: 'FIAE', own: FIAE, other: KFBM },
  { name: 'KfBM', own: KFBM, other: FIAE },
])('HAI context of a $name trainee', ({ own, other }) => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads the index of the own occupation only, as trainee, in the own organization', async () => {
    const { access, search } = await load(own);
    const result = await access.resolveRetrievalAccess(USER);
    expect(result).toMatchObject({
      catalogIds: [own],
      audience: 'trainee',
      organizationId: ORG,
      userId: USER,
    });
    const condition = search.buildScopeCondition(result!);
    const query = dialect.sqlToQuery(condition!);
    expect(query.params).toContain(own);
    expect(query.params).not.toContain(other);
    expect(query.sql.replace(/\s+/g, ' ')).toContain("visibility = 'all'");
    expect(query.sql).not.toContain("trainerSolution' = ");
  });

  it('shows the progress of courses of the own occupation only', async () => {
    const { mock, data } = await load(own);
    await data.fetchTraineeProgress(USER);
    const filter = mock.filters('select', 'course_members');
    expect(filter.params).toContain(own);
    expect(filter.params).not.toContain(other);
  });

  it('counts use cases of the own occupation only', async () => {
    const { mock, data } = await load(own);
    await data.fetchUseCaseProgress(USER);
    const call = (mock.db.execute as jest.Mock).mock.calls[0][0];
    const query = dialect.sqlToQuery(call);
    expect(query.params).toContain(own);
    expect(query.params).not.toContain(other);
    expect(query.sql).toContain('c.training_catalog_id IN');
  });
});
