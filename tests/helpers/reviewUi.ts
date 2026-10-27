// Builders for the tests of the pages of the review list: rows and answers as the
// routes give them, and a fake of the browser client of the review.

import type {
  ReviewClient,
  ReviewListResponse,
} from '@/lib/content-upload/review/client';
import type {
  DuplicateGroupDto,
  ReviewCounts,
  ReviewOptions,
  ReviewRowDto,
} from '@/lib/content-upload/review/types';

let counter = 0;

export const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function rowDto(
  overrides: Partial<ReviewRowDto> & {
    band?: 'high' | 'medium' | 'low' | 'conflict' | null;
  } = {}
): ReviewRowDto {
  counter += 1;
  const { band = 'high', ...rest } = overrides;
  const name = rest.fileName ?? `1a_Quiz_${counter}.docx`;
  const effective = rest.effective ?? {
    docType: band ? 'quiz' : null,
    componentCode: band ? 'K1' : null,
    enablerCode: band ? 'K1-a' : null,
    quizLevel: band ? 'low' : null,
  };
  return {
    id: uuid(counter),
    fileName: name,
    relPath: `Komponente/K1/${name}`,
    ext: 'docx',
    sizeBytes: 142 * 1024,
    pageCount: null,
    status:
      band === null ? 'failed' : band === 'low' ? 'unclear' : 'proposed_rules',
    statusCode: band === null ? 'NO_TEXT' : null,
    clientMtimeMs: Date.UTC(2026, 9, 12),
    proposal:
      band === null
        ? null
        : {
            source: 'path_content',
            ...effective,
            band,
            confidence:
              band === 'high'
                ? 0.99
                : band === 'medium'
                  ? 0.7
                  : band === 'low'
                    ? 0
                    : 0.3,
            reasons: [
              { code: 'AGREE', text: 'Pfad und Inhalt nennen dasselbe.' },
              {
                code: 'IN_POSITIVE_LIST',
                text: 'Komponente und Enabler stehen in der Positivliste.',
              },
            ],
            isNew: false,
          },
    effective,
    decision: null,
    derived: band ? { kind: 'pflicht', phase: 1 } : null,
    duplicate: null,
    copyOfId: null,
    ...rest,
  };
}

export const COUNTS: ReviewCounts = {
  total: 0,
  high: 0,
  medium: 0,
  low: 0,
  conflict: 0,
  duplicates: 0,
  problems: 0,
  skipped: 0,
  accepted: 0,
  rejected: 0,
  deferred: 0,
  open: 0,
  acceptableHigh: 0,
};

export function listResponse(
  rows: ReviewRowDto[],
  overrides: Partial<ReviewListResponse> & {
    status?: string;
    counts?: Partial<ReviewCounts>;
  } = {}
): ReviewListResponse {
  const { status = 'review', counts = {}, ...rest } = overrides;
  const high = rows.filter(r => r.proposal?.band === 'high').length;
  return {
    rows,
    matching: rows.length,
    page: 1,
    pageSize: 50,
    pages: 1,
    version: 0,
    run: {
      id: uuid(900),
      catalog: 'KFBM',
      label: 'KfBM Teil 2 Wahl',
      status: status as any,
      kiEnabled: true,
      decisionsVersion: 0,
      createdById: uuid(1),
      createdAt: '2026-10-27T10:00:00.000Z',
      updatedAt: '2026-10-27T10:00:00.000Z',
    },
    counts: {
      ...COUNTS,
      total: rows.length,
      high,
      medium: rows.filter(r => r.proposal?.band === 'medium').length,
      low: rows.filter(r => r.proposal?.band === 'low').length,
      conflict: rows.filter(r => r.proposal?.band === 'conflict').length,
      problems: rows.filter(r => r.status === 'failed').length,
      open: rows.filter(r => r.decision === null && r.status !== 'failed')
        .length,
      acceptableHigh: high,
      ...counts,
    },
    facets: { components: ['K1'], docTypes: ['quiz'] },
    ...rest,
  };
}

export const OPTIONS: ReviewOptions = {
  docTypes: [
    'enabler',
    'quiz',
    'global_quiz',
    'scenario',
    'use_case',
    'pdf_original',
  ],
  quizLevels: ['low', 'medium', 'high'],
  components: [
    {
      code: 'K1',
      title: 'Erfundenes Thema',
      isNew: false,
      enablers: [
        { code: 'K1-a', title: null, isNew: false },
        { code: 'K1-b', title: null, isNew: false },
      ],
    },
    {
      code: 'K12',
      title: null,
      isNew: false,
      enablers: [{ code: 'K12-a', title: null, isNew: false }],
    },
  ],
};

export function group(
  overrides: Partial<DuplicateGroupDto> = {}
): DuplicateGroupDto {
  return {
    key: 'quiz:1a:low',
    label: {
      docType: 'quiz',
      componentCode: 'K1',
      enablerCode: 'K1-a',
      quizLevel: 'low',
    },
    members: [
      {
        fileId: uuid(501),
        fileName: '12a_Quiz_Low_v2.docx',
        relPath: 'x/12a_Quiz_Low_v2.docx',
        sizeBytes: 2048,
        pageCount: null,
        clientMtimeMs: Date.UTC(2026, 9, 12),
        version: 2,
        suggested: true,
        decision: null,
      },
      {
        fileId: uuid(502),
        fileName: '12a_Quiz_Low.docx',
        relPath: 'x/12a_Quiz_Low.docx',
        sizeBytes: 2000,
        pageCount: null,
        clientMtimeMs: Date.UTC(2026, 8, 3),
        version: 0,
        suggested: false,
        decision: null,
      },
    ],
    suggestedId: uuid(501),
    ambiguous: false,
    reasons: [
      {
        code: 'NEWEST_VERSION',
        text: 'Vorschlag: die Fassung mit der höchsten Version.',
      },
    ],
    resolved: false,
    ...overrides,
  };
}

/** A client whose calls are jest functions with sensible answers. */
export function fakeClient(
  overrides: Partial<ReviewClient> = {}
): jest.Mocked<ReviewClient> {
  return {
    overview: jest.fn(async () => ({ runs: [] })),
    review: jest.fn(async () => listResponse([])),
    options: jest.fn(async () => OPTIONS),
    duplicates: jest.fn(async () => ({ groups: [], version: 0 })),
    decide: jest.fn(async () => ({ version: 1, written: 1, skipped: [] })),
    reopen: jest.fn(async () => ({ version: 1 })),
    ...overrides,
  } as jest.Mocked<ReviewClient>;
}
