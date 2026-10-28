/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  planDocumentIndexing,
  type DocumentIndexRow,
} from '@/lib/hai/indexScope';

// Which content_documents row the reindex writes, as what, for whom (package
// KI5.3). The rows of a use case hold a task that trainees see (TRAINEE_QUESTION)
// and a model solution that only trainers see (TRAINER_SOLUTION). A solution
// must never reach an index that trainees can read.

const KFBM = '00000000-0000-4000-8000-000000000002';
const FIAE = '00000000-0000-4000-8000-000000000001';
const ORG = '11111111-1111-4111-8111-111111111111';
const PDF =
  'https://project.supabase.co/storage/v1/object/public/content/a.pdf';
const TEXT = 'Ausgangssituation: ein Kunde ruft an und bittet um ein Angebot.';

const TYPES = [
  'THEORY',
  'EXERCISE',
  'REFERENCE',
  'OTHER',
  'TRAINEE_QUESTION',
  'TRAINER_SOLUTION',
  null,
];
const VISIBILITIES = ['ALL', 'TRAINEE_ONLY', 'TRAINER_ONLY', null];

function row(extra: Partial<DocumentIndexRow> = {}): DocumentIndexRow {
  return {
    documentType: 'THEORY',
    visibility: 'ALL',
    storageUrl: PDF,
    mimeType: 'application/pdf',
    description: null,
    organizationId: null,
    enablerCatalogId: KFBM,
    useCaseCatalogId: null,
    courseCatalogId: null,
    ...extra,
  };
}

/** The rule of the trainee document routes: what a trainee may open. */
function traineeMayOpen(type: string | null, visibility: string | null) {
  return (
    type !== 'TRAINER_SOLUTION' &&
    (visibility === 'ALL' ||
      visibility === 'TRAINEE_ONLY' ||
      visibility === null)
  );
}

describe('planDocumentIndexing: a PDF file', () => {
  it('is read as a PDF, in the catalog of its enabler, for trainees', () => {
    expect(planDocumentIndexing(row())).toEqual({
      kind: 'pdf',
      scope: {
        trainingCatalogId: KFBM,
        visibility: 'all',
        organizationId: null,
      },
    });
  });

  it('takes the catalog of the enabler, then of the use case, then of the course', () => {
    const both = row({ enablerCatalogId: null, useCaseCatalogId: FIAE });
    expect(planDocumentIndexing(both)).toMatchObject({
      scope: { trainingCatalogId: FIAE },
    });
    const course = row({
      enablerCatalogId: null,
      useCaseCatalogId: null,
      courseCatalogId: KFBM,
    });
    expect(planDocumentIndexing(course)).toMatchObject({
      scope: { trainingCatalogId: KFBM },
    });
  });

  it('keeps the organization of the document', () => {
    expect(planDocumentIndexing(row({ organizationId: ORG }))).toMatchObject({
      scope: { organizationId: ORG },
    });
  });

  it('is not indexed without a catalog (nobody would see it)', () => {
    const none = row({ enablerCatalogId: null });
    expect(planDocumentIndexing(none)).toEqual({
      kind: 'skip',
      reason: 'no training catalog',
    });
  });

  it('is refused when it is a Word file or no PDF', () => {
    for (const mimeType of [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ]) {
      expect(planDocumentIndexing(row({ mimeType }))).toEqual({
        kind: 'skip',
        reason: 'word file',
      });
    }
    expect(planDocumentIndexing(row({ mimeType: 'image/png' }))).toEqual({
      kind: 'skip',
      reason: 'not a pdf',
    });
    // an unknown type is read as before (the default of the column is PDF)
    expect(planDocumentIndexing(row({ mimeType: null }))).toMatchObject({
      kind: 'pdf',
    });
  });
});

describe('planDocumentIndexing: what is fetched', () => {
  it('fetches an http or https address only (no file, ftp, data or other scheme)', () => {
    for (const storageUrl of [
      'file:///etc/passwd',
      'ftp://host/a.pdf',
      'data:application/pdf;base64,AAAA',
      'javascript:alert(1)',
      '/relative/path.pdf',
      'a.pdf',
    ]) {
      expect(planDocumentIndexing(row({ storageUrl }))).toEqual({
        kind: 'skip',
        reason: 'not an http url',
      });
    }
    expect(
      planDocumentIndexing(row({ storageUrl: 'http://localhost/a.pdf' }))
    ).toMatchObject({ kind: 'pdf' });
  });
});

describe('planDocumentIndexing: a model solution in the private bucket', () => {
  it('is never fetched (the reference is no url)', () => {
    const reference = row({
      documentType: 'TRAINER_SOLUTION',
      visibility: 'TRAINER_ONLY',
      storageUrl: 'private://content-solutions/preview/kfbm/uc-1.pdf',
    });
    expect(planDocumentIndexing(reference)).toEqual({
      kind: 'skip',
      reason: 'private reference',
    });
  });

  it('is skipped as private whatever its type says', () => {
    const odd = row({
      documentType: 'THEORY',
      visibility: 'ALL',
      storageUrl: '  private://content-solutions/x.pdf',
    });
    expect(planDocumentIndexing(odd)).toMatchObject({
      reason: 'private reference',
    });
  });
});

describe('planDocumentIndexing: a text row of the import', () => {
  const textRow = (extra: Partial<DocumentIndexRow> = {}) =>
    row({
      storageUrl: '',
      mimeType: 'text/plain',
      description: TEXT,
      ...extra,
    });

  it('is indexed from its description, not fetched', () => {
    expect(
      planDocumentIndexing(
        textRow({ documentType: 'TRAINEE_QUESTION', visibility: 'ALL' })
      )
    ).toEqual({
      kind: 'text',
      scope: {
        trainingCatalogId: KFBM,
        visibility: 'all',
        organizationId: null,
      },
    });
  });

  it('is trainer level when it is the solution of a scenario or a use case', () => {
    for (const extra of [
      { documentType: 'TRAINER_SOLUTION', visibility: 'TRAINER_ONLY' },
      { documentType: 'TRAINER_SOLUTION', visibility: 'ALL' },
      { documentType: 'THEORY', visibility: 'TRAINER_ONLY' },
    ]) {
      expect(planDocumentIndexing(textRow(extra))).toMatchObject({
        kind: 'text',
        scope: { visibility: 'trainer' },
      });
    }
  });

  it('is skipped when it has no usable text', () => {
    for (const description of [null, '', '   ', 'kurz']) {
      expect(planDocumentIndexing(textRow({ description }))).toEqual({
        kind: 'skip',
        reason: 'no file and no text',
      });
    }
    expect(planDocumentIndexing(textRow({ storageUrl: null }))).toMatchObject({
      kind: 'text',
    });
  });

  it('is no text row when a file is there (the file is read, not the description)', () => {
    expect(
      planDocumentIndexing(
        textRow({ storageUrl: PDF, mimeType: 'application/pdf' })
      )
    ).toMatchObject({ kind: 'pdf' });
  });
});

describe('planDocumentIndexing: solutions never reach trainees', () => {
  const forms = [
    { storageUrl: PDF, mimeType: 'application/pdf', description: null },
    { storageUrl: '', mimeType: 'text/plain', description: TEXT },
    { storageUrl: null, mimeType: null, description: TEXT },
  ];

  it('gives visibility trainer to every solution, in every form and combination', () => {
    for (const type of TYPES) {
      for (const visibility of VISIBILITIES) {
        for (const form of forms) {
          const plan = planDocumentIndexing(
            row({ documentType: type, visibility, ...form })
          );
          if (plan.kind === 'skip') continue;
          if (type === 'TRAINER_SOLUTION' || visibility === 'TRAINER_ONLY') {
            expect(plan.scope.visibility).toBe('trainer');
          }
        }
      }
    }
  });

  it('is trainee readable exactly where the trainee routes let a trainee open it', () => {
    for (const type of TYPES) {
      for (const visibility of VISIBILITIES) {
        const plan = planDocumentIndexing(
          row({ documentType: type, visibility })
        );
        if (plan.kind === 'skip') throw new Error('unexpected skip');
        expect(plan.scope.visibility === 'all').toBe(
          traineeMayOpen(type, visibility)
        );
      }
    }
  });
});
