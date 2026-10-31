/**
 * Harness of the golden set: the in-memory index, the access of a case and the
 * state that the mocks of goldenSet.pipeline.test.ts share. No model, no
 * database. The mocks themselves live in the test file (jest.mock is hoisted
 * there) and reach this module with jest.requireActual.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  parseGoldenSet,
  type GoldenCase,
  type GoldenCatalogCode,
  type GoldenChunk,
  type GoldenSet,
} from '@/lib/hai/goldenSet';
import { FIAE_CATALOG, KFBM_CATALOG } from '../fixtures/kfbmPersona';

export const USER = '10000000-0000-4000-8000-000000000001';
export const ORG = 'b0000000-0000-4000-8000-00000000000b';

export const CATALOGS = {
  FIAE: FIAE_CATALOG,
  KFBM: KFBM_CATALOG,
} as const;

export function loadGoldenSet(): GoldenSet {
  return parseGoldenSet(
    JSON.parse(
      fs.readFileSync(
        path.join(
          process.cwd(),
          'tests',
          'unit',
          'hai',
          'golden',
          'hai-golden-set.json'
        ),
        'utf-8'
      )
    )
  );
}

export interface GoldenAccess {
  catalogIds: string[];
  audience: 'trainee' | 'trainer';
  organizationId: string | null;
  userId: string;
  /** Model solutions of the private bucket: trainer audience and switch on. */
  includeTrainerSolutions?: boolean;
}

/**
 * The access that the database would give the person of a case. A trainer gets
 * the permission for the model solutions of the private bucket only while the
 * switch HAI_TRAINER_SOLUTIONS is on (goldenState.trainerSolutionsOn).
 */
export function accessFor(goldenCase: GoldenCase): GoldenAccess {
  return {
    catalogIds: goldenCase.occupations.map(code => CATALOGS[code].id),
    audience: goldenCase.role === 'TRAINER' ? 'trainer' : 'trainee',
    organizationId: null,
    userId: USER,
    ...(goldenCase.role === 'TRAINER' && goldenState.trainerSolutionsOn
      ? { includeTrainerSolutions: true }
      : {}),
  };
}

/** Whether the person of a case may read a chunk (the contract of the SQL filter). */
export function mayRead(goldenCase: GoldenCase, chunk: GoldenChunk): boolean {
  return (
    goldenCase.occupations.includes(chunk.catalog) &&
    (goldenCase.role === 'TRAINER' || chunk.visibility === 'all') &&
    (!chunk.privateSolution ||
      (goldenCase.role === 'TRAINER' && goldenState.trainerSolutionsOn))
  );
}

export function catalogCode(id: string): GoldenCatalogCode {
  return id === CATALOGS.FIAE.id ? 'FIAE' : 'KFBM';
}

export interface SearchCall {
  catalogIds: string[];
  audience: string;
}

/** What the mocks record and return; reset before every case. */
export const goldenState = {
  index: [] as GoldenChunk[],
  access: null as GoldenAccess | null,
  /** Replaces the model: gets the system prompt, returns the answer. */
  model: (async () => 'Antwort') as (systemPrompt: string) => Promise<string>,
  systemPrompts: [] as string[],
  searchCalls: [] as SearchCall[],
  pageIndexCalls: [] as Array<{ catalogIds: string[]; audience: string }>,
  returnedIds: [] as string[],
  /** The switch HAI_TRAINER_SOLUTIONS of the server. Default for the tests: on. */
  trainerSolutionsOn: true,
  reset() {
    this.trainerSolutionsOn = true;
    this.systemPrompts = [];
    this.searchCalls = [];
    this.pageIndexCalls = [];
    this.returnedIds = [];
  },
};

/**
 * The search the pipeline gets: the index filtered by the contract of the SQL
 * filter of vectorSearch.ts (catalog, visibility). The real filter is checked
 * against this contract in the test (buildScopeCondition).
 */
export function fakeSearchWithContext(
  query: string,
  _context: unknown,
  options: {
    catalogIds: string[];
    audience: string;
    includeTrainerSolutions?: boolean;
  }
) {
  goldenState.searchCalls.push({
    catalogIds: options.catalogIds,
    audience: options.audience,
  });
  const results = goldenState.index
    .filter(
      chunk =>
        options.catalogIds.includes(CATALOGS[chunk.catalog].id) &&
        (options.audience === 'trainer' || chunk.visibility === 'all') &&
        (!chunk.privateSolution ||
          (options.audience === 'trainer' &&
            options.includeTrainerSolutions === true))
    )
    .map(chunk => ({
      id: chunk.id,
      sourceType: chunk.sourceType,
      sourceId: chunk.id,
      chunkIndex: 0,
      content: chunk.text,
      similarity: 0.9,
      metadata: {
        title: chunk.id,
        ...(chunk.privateSolution ? { trainerSolution: true } : {}),
      },
    }));
  goldenState.returnedIds.push(...results.map(r => r.id));
  return Promise.resolve({ results, query, totalResults: results.length });
}

export function canaryMap(set: GoldenSet): Map<string, string> {
  return new Map(set.index.map(chunk => [chunk.id, chunk.canary]));
}
