/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { createTableDb, renderCondition } from '../../../helpers/mockDb';
import { fakeSession } from '../../../helpers/mockNext';

// Module under test: src/lib/auth/trainee-scope-conditions.ts. The SQL for the
// trainees a trainer-level caller may see: role TRAINEE, the organization of
// the session (everybody but the super admin) and the chosen occupation.

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

async function load(
  options: {
    catalog?: { condition: any } | NextResponse;
    rows?: any[];
  } = {}
) {
  jest.resetModules();
  const mock = createTableDb({ profiles: options.rows ?? [] });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/catalog/trainee-scope', () => ({
    __esModule: true,
    requireTraineeCatalogFilter: async () =>
      options.catalog ?? { condition: null },
  }));
  const mod = await import('@/lib/auth/trainee-scope-conditions');
  return { ...mod, mock };
}

const request = { url: 'http://localhost/api/x', headers: { get: () => null } };
const trainer = fakeSession({ organizationId: 'org-1' });
const superAdmin = fakeSession({
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
});

describe('requireTraineeScopeCondition', () => {
  beforeEach(() => jest.clearAllMocks());

  it('limits a trainer to trainees of the own organization', async () => {
    const { requireTraineeScopeCondition } = await load();
    const scope = (await requireTraineeScopeCondition(
      trainer as any,
      request as any
    )) as any;
    const { sql: text, params } = renderCondition(scope.condition);
    expect(text).toContain('"profiles"."role" = $');
    expect(text).toContain('"profiles"."organization_id" = $');
    expect(params).toEqual(['TRAINEE', 'org-1']);
  });

  it('does not widen the scope for the platform-owner flag of the organization', async () => {
    const { requireTraineeScopeCondition } = await load();
    const scope = (await requireTraineeScopeCondition(
      fakeSession({ organizationId: 'org-1', isPlatformOwner: true }) as any,
      request as any
    )) as any;
    expect(renderCondition(scope.condition).params).toEqual([
      'TRAINEE',
      'org-1',
    ]);
  });

  it('leaves the organization open for the super admin, only trainees remain', async () => {
    const { requireTraineeScopeCondition } = await load();
    const scope = (await requireTraineeScopeCondition(
      superAdmin as any,
      request as any
    )) as any;
    const { sql: text, params } = renderCondition(scope.condition);
    expect(text).not.toContain('organization_id');
    expect(params).toEqual(['TRAINEE']);
  });

  it('adds the occupation condition once an occupation is chosen', async () => {
    const { requireTraineeScopeCondition } = await load({
      catalog: { condition: sql`exists (select 1 from marker)` },
    });
    const scope = (await requireTraineeScopeCondition(
      trainer as any,
      request as any
    )) as any;
    expect(renderCondition(scope.condition).sql).toContain(
      'exists (select 1 from marker)'
    );
  });

  it('passes on a rejected occupation (403)', async () => {
    const { requireTraineeScopeCondition } = await load({
      catalog: NextResponse.json({ error: 'nope' }, { status: 403 }),
    });
    const res = (await requireTraineeScopeCondition(
      trainer as any,
      request as any
    )) as Response;
    expect(res.status).toBe(403);
  });
});

describe('traineeIdInScope', () => {
  it('renders a sub-select on the trainee condition', async () => {
    const { requireTraineeScopeCondition, traineeIdInScope } = await load();
    const scope = (await requireTraineeScopeCondition(
      trainer as any,
      request as any
    )) as any;
    const { quizSubmissions } = await import('@/db/migrations/schemas/schema');
    const { sql: text, params } = renderCondition(
      traineeIdInScope(quizSubmissions.traineeId, scope.condition)
    );
    expect(text).toContain('"quiz_submissions"."trainee_id" in (select');
    expect(text).toContain('from "profiles" where');
    expect(params).toEqual(['TRAINEE', 'org-1']);
  });
});

describe('traineeIdsInScope', () => {
  it('returns the ids the database confirms for the scope', async () => {
    const { traineeIdsInScope, mock } = await load({ rows: [{ id: A }] });
    const ids = (await traineeIdsInScope(trainer as any, request as any, [
      A,
      B,
      A,
    ])) as Set<string>;
    expect([...ids]).toEqual([A]);
    const filter = mock.filters('select', 'profiles');
    expect(filter.sql).toContain('"profiles"."organization_id" = $');
    expect(filter.params).toContain('org-1');
    expect(filter.params).toContain(A);
    expect(filter.params).toContain(B);
  });

  it('never asks the database for an id that is no uuid', async () => {
    const { traineeIdsInScope, mock } = await load({ rows: [] });
    const ids = (await traineeIdsInScope(trainer as any, request as any, [
      'not-a-uuid',
      "' or 1=1 --",
    ])) as Set<string>;
    expect(ids.size).toBe(0);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('passes on a rejected occupation (403)', async () => {
    const { traineeIdsInScope } = await load({
      catalog: NextResponse.json({ error: 'nope' }, { status: 403 }),
    });
    const res = (await traineeIdsInScope(trainer as any, request as any, [
      A,
    ])) as Response;
    expect(res.status).toBe(403);
  });
});
