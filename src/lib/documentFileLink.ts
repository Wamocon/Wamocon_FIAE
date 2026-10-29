/**
 * Opens the file of a document in a new tab with a fresh signed address.
 *
 * A link that is stored (a source in the HAI chat) cannot carry a signed
 * address, it would be dead after an hour, and a plain link cannot send the
 * session of the app (a bearer token). So the click asks the route
 * /api/documents/[documentId]/file, which answers only for a person who may see
 * the document. The tab is opened at once (a popup that opens after an await is
 * blocked) and gets the address when it arrives.
 */

import { authFetch } from '@/lib/authFetch';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `id` can name a document (the shape of a uuid). */
export const isDocumentId = (id: unknown): id is string =>
  typeof id === 'string' && UUID.test(id);

/** Only a web address is ever opened. */
const isWebAddress = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\//i.test(value);

export type OpenDocumentDeps = {
  fetchFile?: (path: string) => Promise<Response>;
  openWindow?: () => Window | null;
  openLater?: (url: string) => Window | null;
};

/**
 * Opens the document. `fallbackUrl` is used when the route gives no address
 * (an old link of a public bucket still works that way). Returns false when
 * nothing could be opened.
 */
export async function openDocumentFile(
  documentId: string,
  fallbackUrl?: string,
  deps: OpenDocumentDeps = {}
): Promise<boolean> {
  if (!isDocumentId(documentId)) return false;
  const win = (deps.openWindow ?? (() => window.open('', '_blank')))();
  if (win) {
    try {
      win.opener = null;
    } catch {
      // a window that cannot be changed is still navigated below
    }
  }

  let target: string | null = null;
  try {
    const response = await (deps.fetchFile ?? authFetch)(
      `/api/documents/${documentId}/file`
    );
    if (response.ok) {
      const body = (await response.json()) as { url?: unknown };
      if (isWebAddress(body.url)) target = body.url;
    }
  } catch {
    target = null;
  }
  if (!target && isWebAddress(fallbackUrl)) target = fallbackUrl;

  if (!target) {
    win?.close();
    return false;
  }
  if (win) {
    win.location.href = target;
    return true;
  }
  // The tab was blocked: try once more now that the address is known, but never
  // replace the page the person is on (the chat would be lost)
  const late = (
    deps.openLater ?? (url => window.open(url, '_blank', 'noopener'))
  )(target);
  return late !== null;
}
