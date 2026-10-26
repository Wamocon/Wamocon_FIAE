/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  CHUNK_INDEX_BLOCK,
  SCENARIO_HINT_VISIBILITY,
  TRAINER_PART_CHUNK_OFFSET,
  chunkIndexRange,
  documentVisibility,
  firstCatalogId,
  isHaiVisibility,
  scopeProblem,
} from '@/lib/hai/indexScope';
import { citationUrl } from '@/lib/hai/citationUrl';

const FIAE = '00000000-0000-4000-8000-000000000001';
const ORG = '11111111-1111-4111-8111-111111111111';

describe('scopeProblem: a writer needs an explicit, complete scope', () => {
  it('accepts a complete scope, with or without an organization', () => {
    expect(
      scopeProblem({
        trainingCatalogId: FIAE,
        visibility: 'all',
        organizationId: null,
      })
    ).toBeNull();
    expect(
      scopeProblem({
        trainingCatalogId: FIAE,
        visibility: 'trainer',
        organizationId: ORG,
      })
    ).toBeNull();
  });

  it('refuses a missing scope', () => {
    expect(scopeProblem(undefined)).toMatch(/missing/);
  });

  it('refuses a missing or malformed catalog (a NULL row is visible to nobody)', () => {
    expect(
      scopeProblem({
        trainingCatalogId: null,
        visibility: 'all',
        organizationId: null,
      })
    ).toMatch(/trainingCatalogId/);
    expect(
      scopeProblem({
        trainingCatalogId: 'FIAE',
        visibility: 'all',
        organizationId: null,
      })
    ).toMatch(/trainingCatalogId/);
  });

  it('refuses a visibility that is neither all nor trainer', () => {
    expect(
      scopeProblem({
        trainingCatalogId: FIAE,
        visibility: 'everyone' as never,
        organizationId: null,
      })
    ).toMatch(/visibility/);
    expect(
      scopeProblem({ trainingCatalogId: FIAE, organizationId: null })
    ).toMatch(/visibility/);
  });

  it('refuses an organization that is left out (null must be explicit)', () => {
    expect(
      scopeProblem({ trainingCatalogId: FIAE, visibility: 'all' })
    ).toMatch(/organizationId/);
    expect(
      scopeProblem({
        trainingCatalogId: FIAE,
        visibility: 'all',
        organizationId: 'not-a-uuid',
      })
    ).toMatch(/organizationId/);
  });
});

describe('visibility rules of the writers', () => {
  it('knows the two visibilities only', () => {
    expect(isHaiVisibility('all')).toBe(true);
    expect(isHaiVisibility('trainer')).toBe(true);
    expect(isHaiVisibility('TRAINER')).toBe(false);
    expect(isHaiVisibility(undefined)).toBe(false);
  });

  it('trainer solutions and trainer-only documents are trainer level', () => {
    expect(documentVisibility('TRAINER_SOLUTION', 'ALL')).toBe('trainer');
    expect(documentVisibility('THEORY', 'TRAINER_ONLY')).toBe('trainer');
    expect(documentVisibility('THEORY', 'ALL')).toBe('all');
    expect(documentVisibility('THEORY', 'TRAINEE_ONLY')).toBe('all');
    expect(documentVisibility(null, null)).toBe('all');
  });

  it('keeps the scenario hint trainer only by default (the owner may reverse it)', () => {
    expect(SCENARIO_HINT_VISIBILITY).toBe('trainer');
  });

  it('takes the first catalog of enabler, use case, course', () => {
    expect(firstCatalogId(null, undefined, FIAE)).toBe(FIAE);
    expect(firstCatalogId('a', 'b')).toBe('a');
    expect(firstCatalogId(null, undefined)).toBeNull();
  });

  it('keeps the trainer part in its own block of chunk indexes', () => {
    expect(TRAINER_PART_CHUNK_OFFSET).toBe(CHUNK_INDEX_BLOCK);
    expect(chunkIndexRange(0)).toEqual({ from: 0, to: 10000 });
    expect(chunkIndexRange(TRAINER_PART_CHUNK_OFFSET)).toEqual({
      from: 10000,
      to: 20000,
    });
  });
});

describe('citationUrl: only a PageIndex hit carries a URL', () => {
  it('gives the URL of a PageIndex citation', () => {
    expect(
      citationUrl({
        id: 'pageindex-d1-p3',
        metadata: { sourceType: 'pageindex', storageUrl: 'https://x/doc.pdf' },
      })
    ).toBe('https://x/doc.pdf');
  });

  it('gives none for a PageIndex citation of a document trainees may not see', () => {
    expect(
      citationUrl({
        id: 'pageindex-d1-p3',
        metadata: { sourceType: 'pageindex', storageUrl: undefined },
      })
    ).toBeUndefined();
  });

  it('never takes a url or storageUrl from the metadata of a vector hit', () => {
    expect(
      citationUrl({
        id: '8d0f7f8e-0000-4000-8000-000000000000',
        metadata: { storageUrl: 'https://x/solution.pdf', url: 'https://y' },
      })
    ).toBeUndefined();
    // a chunk cannot claim to be a PageIndex hit through its metadata alone
    expect(
      citationUrl({
        id: '8d0f7f8e-0000-4000-8000-000000000000',
        metadata: { sourceType: 'pageindex', storageUrl: 'https://x/s.pdf' },
      })
    ).toBeUndefined();
    expect(citationUrl({})).toBeUndefined();
  });

  it('gives no URL that is not a web address', () => {
    for (const storageUrl of [
      'javascript:alert(1)',
      'data:text/html,<script>',
      'file:///etc/passwd',
      '//evil.example/x',
      '',
    ]) {
      expect(
        citationUrl({
          id: 'pageindex-d1-p3',
          metadata: { sourceType: 'pageindex', storageUrl },
        })
      ).toBeUndefined();
    }
  });
});
