/**
 * @jest-environment node
 */
import { describe, it, expect, jest } from '@jest/globals';
import { renderCondition } from '../../../helpers/mockDb';

// Behavior under test: traineeScopeCondition in
// src/lib/auth/activity-report-access.ts, the SQL condition behind every write
// of a trainer on reports, entries and ratings. A trainee profile without an
// organization is outside every organization scope (fail closed), like in
// isInOrgScope and orgScopeCondition: it used to be counted as the default
// organization here, so an admin of that organization could change records
// that no list shows them.

const ORG = '11111111-1111-4111-8111-111111111111';

async function load() {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: {} }));
  const access = await import('@/lib/auth/activity-report-access');
  const schema = await import('@/db/migrations/schemas/schema');
  return { access, schema };
}

describe('traineeScopeCondition', () => {
  it('compares the organization of the trainee with the scope, without a default for NULL', async () => {
    const { access, schema } = await load();
    const condition = access.traineeScopeCondition(
      schema.activityReports.traineeId,
      { organizationId: ORG, isGlobal: false }
    );
    const { sql, params } = renderCondition(condition);
    expect(sql).toMatch(/exists \(select 1 from "profiles" where/);
    expect(sql).toContain('"profiles"."organization_id" = $');
    expect(sql).not.toMatch(/coalesce/i);
    expect(params).toContain(ORG);
    // the default organization is no longer a parameter of the condition
    expect(params).not.toContain('00000000-0000-0000-0000-000000000001');
  });

  it('adds no organization condition for the platform-wide view', async () => {
    const { access, schema } = await load();
    expect(
      access.traineeScopeCondition(schema.activityReports.traineeId, {
        organizationId: null,
        isGlobal: true,
      })
    ).toBeUndefined();
  });

  it('keeps the catalog condition next to the organization', async () => {
    const { access, schema } = await load();
    const { sql } = renderCondition(
      access.traineeScopeCondition(
        schema.activityReports.traineeId,
        { organizationId: ORG, isGlobal: false },
        (await import('drizzle-orm')).sql`"profiles"."id" is not null`
      )
    );
    expect(sql).toContain('"profiles"."organization_id" = $');
    expect(sql).toContain('"profiles"."id" is not null');
  });
});
