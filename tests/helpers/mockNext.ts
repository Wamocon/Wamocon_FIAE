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
