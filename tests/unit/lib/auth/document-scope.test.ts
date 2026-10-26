/**
 * @jest-environment node
 */
import { describe, it, expect, jest } from '@jest/globals';
import { createTableDb, renderCondition } from '../../../helpers/mockDb';
import { fakeSession } from '../../../helpers/mockNext';

// Behavior under test: src/lib/auth/document-scope.ts, who sees and who deletes
// the documents of enablers and use cases (table content_documents).
//
// A document carries the organization of the person who uploaded it. The
// shared curriculum lives in two forms: documents without an organization and
// documents of the platform organization. A person sees those and the
// documents of the own organization, never the documents of another customer.
// The super admin sees all. The platform flag of a person widens nothing: a
// platform document is deleted by the super admin only (the ADMIN of the
// platform organization is one), a trainer of the platform organization is no
// exception.

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PLATFORM = '00000000-0000-4000-8000-000000000001';

const trainer = fakeSession({ id: 'tr1', organizationId: ORG });
const superAdmin = fakeSession({
  id: 'sa',
  role: 'SUPER_ADMIN',
  organizationId: PLATFORM,
  isSuperAdmin: true,
  isAdmin: true,
  isPlatformOwner: true,
});
const platformTrainer = fakeSession({
  id: 'pt',
  organizationId: PLATFORM,
  isPlatformOwner: true,
});

async function load(organizations: unknown[] = []) {
  jest.resetModules();
  const rec = createTableDb({ organizations: organizations as any[] });
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  const mod = await import('@/lib/auth/document-scope');
  const schema = await import('@/db/migrations/schemas/schema');
  return { mod, schema, rec };
}

describe('documentVisibilityCondition', () => {
  it('limits a person to shared, platform and own documents', async () => {
    const { mod, schema } = await load();
    const { sql, params } = renderCondition(
      mod.documentVisibilityCondition(
        schema.contentDocuments.organizationId,
        trainer as any
      )
    );
    expect(sql).toContain('"content_documents"."organization_id" is null');
    expect(sql).toContain('"content_documents"."organization_id" = $');
    expect(sql).toMatch(
      /"content_documents"\."organization_id" in \(select "organizations"\."id" from "organizations" where "organizations"\."is_platform_owner" = true\)/
    );
    expect(params).toEqual([ORG]);
  });

  it('adds no condition for the super admin', async () => {
    const { mod, schema } = await load();
    expect(
      mod.documentVisibilityCondition(
        schema.contentDocuments.organizationId,
        superAdmin as any
      )
    ).toBeUndefined();
  });

  it('does not widen for a trainer of the platform organization', async () => {
    const { mod, schema } = await load();
    const condition = mod.documentVisibilityCondition(
      schema.contentDocuments.organizationId,
      platformTrainer as any
    );
    expect(condition).toBeDefined();
    expect(renderCondition(condition).params).toEqual([PLATFORM]);
  });
});

describe('canDeleteDocument', () => {
  const platformIds = new Set([PLATFORM]);

  it('lets the super admin delete every document', async () => {
    const { mod } = await load();
    for (const organizationId of [null, ORG, OTHER, PLATFORM]) {
      expect(
        mod.canDeleteDocument(
          superAdmin as any,
          { organizationId },
          platformIds
        )
      ).toBe(true);
    }
  });

  it('lets a trainer delete the documents of the own organization', async () => {
    const { mod } = await load();
    expect(
      mod.canDeleteDocument(
        trainer as any,
        { organizationId: ORG },
        platformIds
      )
    ).toBe(true);
  });

  it('refuses the documents of another organization', async () => {
    const { mod } = await load();
    expect(
      mod.canDeleteDocument(
        trainer as any,
        { organizationId: OTHER },
        platformIds
      )
    ).toBe(false);
  });

  it('refuses the shared curriculum without an organization', async () => {
    const { mod } = await load();
    expect(
      mod.canDeleteDocument(
        trainer as any,
        { organizationId: null },
        platformIds
      )
    ).toBe(false);
  });

  it('refuses platform documents to a trainer of any organization, the platform one included', async () => {
    const { mod } = await load();
    const documentOfPlatform = { organizationId: PLATFORM };
    expect(
      mod.canDeleteDocument(trainer as any, documentOfPlatform, platformIds)
    ).toBe(false);
    // the platform flag of the person changes nothing
    expect(
      mod.canDeleteDocument(
        platformTrainer as any,
        documentOfPlatform,
        platformIds
      )
    ).toBe(false);
  });

  it('refuses a platform document even to a trainer whose own organization is listed as platform', async () => {
    const { mod } = await load();
    expect(
      mod.canDeleteDocument(
        fakeSession({ organizationId: OTHER }) as any,
        { organizationId: OTHER },
        new Set([OTHER])
      )
    ).toBe(false);
  });
});

describe('canCreateDocument', () => {
  const platformIds = new Set([PLATFORM]);

  it('lets a person of a customer organization add documents of the own organization', async () => {
    const { mod } = await load();
    expect(mod.canCreateDocument(trainer as any, ORG, platformIds)).toBe(true);
  });

  it('keeps documents of the platform organization (curriculum) for the super admin', async () => {
    const { mod } = await load();
    expect(
      mod.canCreateDocument(superAdmin as any, PLATFORM, platformIds)
    ).toBe(true);
    // the platform flag of a trainer changes nothing
    expect(
      mod.canCreateDocument(platformTrainer as any, PLATFORM, platformIds)
    ).toBe(false);
    expect(mod.canCreateDocument(trainer as any, PLATFORM, platformIds)).toBe(
      false
    );
  });
});

describe('loadPlatformOrgIds', () => {
  it('reads the organizations that carry the platform flag', async () => {
    const { mod, rec } = await load([{ id: PLATFORM }, { id: OTHER }]);
    const ids = await mod.loadPlatformOrgIds();
    expect([...ids].sort()).toEqual([OTHER, PLATFORM].sort());
    const where = rec.filters('select', 'organizations');
    expect(where.sql).toContain('"organizations"."is_platform_owner" = $');
    expect(where.params).toContain(true);
  });

  it('is empty without a platform organization', async () => {
    const { mod } = await load([]);
    expect((await mod.loadPlatformOrgIds()).size).toBe(0);
  });
});
