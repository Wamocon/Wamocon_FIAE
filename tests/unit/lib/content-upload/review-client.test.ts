/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import { createReviewClient } from '@/lib/content-upload/review/client';
import { UploadApiError } from '@/lib/content-upload/staging/client';

const reply = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) => new Response(JSON.stringify(body), { status, headers });

function setup(response: Response | (() => Response)) {
  const fetch = jest.fn(async (_input: string, _init?: RequestInit) =>
    typeof response === 'function' ? response() : response
  );
  return { fetch, client: createReviewClient({ fetch }) };
}

describe('the browser client of the review', () => {
  it('reads the overview', async () => {
    const { client, fetch } = setup(reply(200, { runs: [] }));
    expect(await client.overview()).toEqual({ runs: [] });
    expect(fetch).toHaveBeenCalledWith('/api/trainer/content-upload/overview', {
      method: 'GET',
    });
  });

  it('reads a page of the list with the filter as a query string', async () => {
    const { client, fetch } = setup(reply(200, { rows: [] }));
    await client.review('r1', {
      band: 'low',
      status: 'open',
      page: 2,
      query: 'a b',
    });
    expect(fetch.mock.calls[0][0]).toBe(
      '/api/trainer/content-upload/runs/r1/review?band=low&status=open&q=a+b&page=2'
    );
    await client.review('r1', {});
    expect(fetch.mock.calls[1][0]).toBe(
      '/api/trainer/content-upload/runs/r1/review'
    );
  });

  it('passes the signal on so that a request can be ended', async () => {
    const { client, fetch } = setup(reply(200, {}));
    const controller = new AbortController();
    await client.options('r1', controller.signal);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      signal: controller.signal,
    });
    await client.duplicates('r1', controller.signal);
    expect(fetch.mock.calls[1][0]).toBe(
      '/api/trainer/content-upload/runs/r1/review/duplicates'
    );
  });

  it('sends a decision as JSON with the version the person saw', async () => {
    const { client, fetch } = setup(
      reply(200, { version: 3, written: 1, skipped: [] })
    );
    await client.decide('r1', 2, { command: 'accept_high' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/trainer/content-upload/runs/r1/decisions');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      expectedVersion: 2,
      command: 'accept_high',
    });
  });

  it('turns a refusal into an error with the status and the code of the route', async () => {
    const { client } = setup(
      reply(409, { error: 'changed', code: 'VERSION_CONFLICT' })
    );
    const error = await client
      .decide('r1', 0, { command: 'accept_high' })
      .catch(e => e);
    expect(error).toBeInstanceOf(UploadApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      message: 'changed',
    });
  });

  it('knows the wait of a rate limit, and copes with an answer that is no JSON', async () => {
    const limited = setup(
      reply(
        429,
        { error: 'slow down', code: 'RATE_LIMITED' },
        { 'Retry-After': '7' }
      )
    );
    expect(await limited.client.overview().catch(e => e)).toMatchObject({
      status: 429,
      retryAfterSec: 7,
    });
    const broken = setup(() => new Response('<html>', { status: 502 }));
    expect(await broken.client.overview().catch(e => e)).toMatchObject({
      status: 502,
      message: 'Request failed (502)',
      code: undefined,
    });
  });
});

describe('every call of the browser goes through authFetch', () => {
  it('imports authFetch and calls no plain fetch', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/content-upload/review/client.ts'),
      'utf8'
    );
    expect(source).toContain("from '@/lib/authFetch'");
    expect(source).toContain('/api/trainer/content-upload');
    expect(source).not.toMatch(/(^|[^\w.])fetch\(/);
  });
});
