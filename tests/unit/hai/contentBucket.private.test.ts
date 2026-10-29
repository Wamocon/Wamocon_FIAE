/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { citationUrl } from '@/lib/hai/citationUrl';
import {
  planDocumentIndexing,
  type DocumentIndexRow,
} from '@/lib/hai/indexScope';

// The bucket content becomes private at the go-live. A document may then store
// the private reference private://content/<path>. HAI must still index it (the
// reader uses the secret key) and a citation must still lead to the file (the
// chat asks the route of the document for a signed address). The references of
// the model solutions (private://content-solutions/) stay out of both.

const DOC = 'dddddddd-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const REF = 'private://content/preview/kfbm/K6.2-d/szenario/a.pdf';

describe('citationUrl with the private reference of the bucket content', () => {
  const hit = (storageUrl: unknown, id = `pageindex-${DOC}-p3`) =>
    citationUrl({ id, metadata: { sourceType: 'pageindex', storageUrl } });

  it('points the citation to the route of the document, not to the reference', () => {
    expect(hit(REF)).toBe(`/api/documents/${DOC}/file`);
  });

  it('never gives a private reference or the other private bucket as a link', () => {
    expect(
      hit('private://content-solutions/preview/kfbm/x.pdf')
    ).toBeUndefined();
    expect(hit('private://avatar/x.png')).toBeUndefined();
  });

  it('needs a PageIndex hit with a document id, a chunk cannot claim it', () => {
    expect(hit(REF, 'pageindex-d1-p3')).toBeUndefined();
    expect(hit(REF, 'pageindex-../../etc-p3')).toBeUndefined();
    expect(
      citationUrl({
        id: DOC,
        metadata: { sourceType: 'pageindex', storageUrl: REF },
      })
    ).toBeUndefined();
    expect(
      citationUrl({
        id: `pageindex-${DOC}-p3`,
        metadata: { storageUrl: REF },
      })
    ).toBeUndefined();
  });

  it('gives none for a document that trainees may not see (no storageUrl)', () => {
    expect(hit(undefined)).toBeUndefined();
  });

  it('an ordinary web address works as before', () => {
    expect(hit('https://x/doc.pdf')).toBe('https://x/doc.pdf');
  });
});

describe('planDocumentIndexing with the private reference of the bucket content', () => {
  const row = (extra: Partial<DocumentIndexRow> = {}): DocumentIndexRow => ({
    documentType: 'THEORY',
    visibility: 'ALL',
    storageUrl: REF,
    mimeType: 'application/pdf',
    description: null,
    organizationId: null,
    enablerCatalogId: KFBM,
    useCaseCatalogId: null,
    courseCatalogId: null,
    ...extra,
  });

  it('indexes the PDF, read with the secret key', () => {
    expect(planDocumentIndexing(row())).toMatchObject({ kind: 'pdf' });
  });

  it('still skips a Word file and a file that is no PDF', () => {
    expect(
      planDocumentIndexing(row({ mimeType: 'application/msword' }))
    ).toEqual({ kind: 'skip', reason: 'word file' });
    expect(planDocumentIndexing(row({ mimeType: 'image/png' }))).toEqual({
      kind: 'skip',
      reason: 'not a pdf',
    });
  });

  it('skips a private reference of the bucket content with a path that is not safe', () => {
    for (const storageUrl of [
      'private://content/../x.pdf',
      'private://content/a%2e%2e/x.pdf',
      'private://content//x.pdf',
    ]) {
      expect(planDocumentIndexing(row({ storageUrl }))).toEqual({
        kind: 'skip',
        reason: 'private reference',
      });
    }
  });

  it('still skips every other private reference', () => {
    for (const storageUrl of [
      'private://content-solutions/preview/kfbm/uc-1.pdf',
      '  private://content-solutions/x.pdf',
      'private://avatar/x.png',
      'private://contentx/x.pdf',
    ]) {
      expect(planDocumentIndexing(row({ storageUrl }))).toEqual({
        kind: 'skip',
        reason: 'private reference',
      });
    }
  });

  it('keeps the visibility of a solution trainer-only in the private form too', () => {
    const plan = planDocumentIndexing(
      row({ documentType: 'TRAINER_SOLUTION', visibility: 'TRAINER_ONLY' })
    );
    expect(plan).toMatchObject({
      kind: 'pdf',
      scope: { visibility: 'trainer' },
    });
  });
});
