// Lightweight helpers to invoke Next.js Route Handlers in tests without a running server
// Note: These are intentionally permissive (any) to avoid tight coupling to Next types

export function makeGetRequest(url: string): any {
  return { url } as any; // Handlers typically use new URL(req.url)
}

export function makePostRequest(url: string, body?: unknown): any {
  return {
    url,
    json: async () => body,
  } as any; // Handlers typically do await req.json()
}

export async function readJson(res: Response | any) {
  if (typeof res?.json === 'function') return await res.json();
  return res;
}

// ---------------------------------------------------------------------------
// Authenticated requests and the session layer
// ---------------------------------------------------------------------------

export type RequestOptions = {
  /** Bearer token to send. Omit (or pass null) for an anonymous request. */
  token?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * Build a request double with `url`, `headers.get`, `method`, `json()` and
 * `nextUrl`, enough for handlers that read the Authorization header.
 */
export function makeRequest(
  method: string,
  url: string,
  options: RequestOptions = {}
): any {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.headers ?? {})) {
    headers[k.toLowerCase()] = v;
  }
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => options.body,
    text: async () => JSON.stringify(options.body ?? ''),
  } as any;
}

export function makeAuthedGet(url: string, token = 'test-token'): any {
  return makeRequest('GET', url, { token });
}

export function makeAuthedPost(
  url: string,
  body?: unknown,
  token = 'test-token'
): any {
  return makeRequest('POST', url, { token, body });
}

export type TestAuthUser = { id: string; email?: string };

/**
 * Replace the Supabase client so that `auth.getUser(token)` resolves the given
 * tokens to users and rejects every other token. Call this before importing
 * the route (after jest.resetModules()).
 */
export function mockSupabaseAuth(tokens: Record<string, TestAuthUser>) {
  const getUser = jest.fn(async (token?: string) => {
    const user = token ? tokens[token] : undefined;
    return user
      ? { data: { user }, error: null }
      : { data: { user: null }, error: { message: 'invalid JWT' } };
  });
  jest.doMock('@supabase/supabase-js', () => ({
    __esModule: true,
    createClient: () => ({ auth: { getUser } }),
  }));
  return getUser;
}

/**
 * The row the session layer reads for the caller (profiles joined with their
 * organization). Use it as the first entry of the `profiles` sequence in
 * createTableDb, because the session lookup is the handler's first query.
 */
export function sessionProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-user',
    email: 'session@example.com',
    fullName: 'Session User',
    role: 'TRAINER',
    organizationId: 'org-1',
    isActive: true,
    orgIsActive: true,
    isPlatformOwner: false,
    ...overrides,
  };
}
