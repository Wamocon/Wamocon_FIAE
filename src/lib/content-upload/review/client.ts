// The browser side of the review list (package U6): the calls of the pages to the
// routes under /api/trainer/content-upload. Every call goes through authFetch (the
// bearer token). Errors come as UploadApiError with the status and the stable code
// of the route, so a page can tell "reload, the decisions changed" (409
// VERSION_CONFLICT) from "the run is not in review" (409 RUN_STATE) and "the
// content upload is off here" (404).

import { authFetch } from '@/lib/authFetch';
import { filterToParams } from '@/lib/content-upload/review/filter';
import type {
  DuplicateGroupDto,
  ReviewCounts,
  ReviewFacets,
  ReviewFilter,
  ReviewOptions,
  ReviewPage,
} from '@/lib/content-upload/review/types';
import type { DecisionOutcome } from '@/lib/content-upload/review/decisions';
import type { DecisionCommandInput } from '@/lib/content-upload/review/validate';
import type { RunOverviewItem } from '@/lib/content-upload/review/service';
import type { RunDto } from '@/lib/content-upload/staging/runs';
import { UploadApiError } from '@/lib/content-upload/staging/client';

const BASE = '/api/trainer/content-upload';

export interface ReviewListResponse extends ReviewPage {
  run: RunDto;
  counts: ReviewCounts;
  facets: ReviewFacets;
  version: number;
}

export interface ReviewClientDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export function createReviewClient(partial: Partial<ReviewClientDeps> = {}) {
  const deps: ReviewClientDeps = {
    fetch: (input, init) => authFetch(input, init),
    ...partial,
  };

  async function api<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    const response = await deps.fetch(path, {
      method,
      ...(signal ? { signal } : {}),
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      any
    >;
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      throw new UploadApiError(
        response.status,
        typeof data.error === 'string'
          ? data.error
          : `Request failed (${response.status})`,
        typeof data.code === 'string' ? data.code : undefined,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
      );
    }
    return data as T;
  }

  return {
    overview(signal?: AbortSignal) {
      return api<{ runs: RunOverviewItem[] }>(
        'GET',
        `${BASE}/overview`,
        undefined,
        signal
      );
    },
    review(runId: string, filter: ReviewFilter, signal?: AbortSignal) {
      const query = filterToParams(filter).toString();
      return api<ReviewListResponse>(
        'GET',
        `${BASE}/runs/${runId}/review${query ? `?${query}` : ''}`,
        undefined,
        signal
      );
    },
    options(runId: string, signal?: AbortSignal) {
      return api<ReviewOptions>(
        'GET',
        `${BASE}/runs/${runId}/review/options`,
        undefined,
        signal
      );
    },
    duplicates(runId: string, signal?: AbortSignal) {
      return api<{ groups: DuplicateGroupDto[]; version: number }>(
        'GET',
        `${BASE}/runs/${runId}/review/duplicates`,
        undefined,
        signal
      );
    },
    decide(
      runId: string,
      expectedVersion: number,
      command: DecisionCommandInput
    ) {
      return api<DecisionOutcome>('POST', `${BASE}/runs/${runId}/decisions`, {
        expectedVersion,
        ...command,
      });
    },
  };
}

export type ReviewClient = ReturnType<typeof createReviewClient>;
