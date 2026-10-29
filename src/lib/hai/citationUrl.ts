/**
 * URL of a citation. Only a PageIndex hit carries one, and the PageIndex sets
 * storageUrl only for documents that trainees may see (pageIndexService.ts).
 * A hit of the vector index never gets a URL: its metadata is whatever the
 * writer stored and could hold any url or storageUrl (a trainer solution, a
 * foreign link), and the storage bucket is public.
 */

/** `pageindex-<document id>-p<page>`, the id of a PageIndex hit. */
const PAGEINDEX_ID =
  /^pageindex-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-p\d+$/i;

interface CitationSource {
  id?: string;
  metadata?: Record<string, unknown> | null;
}

export function citationUrl(result: CitationSource): string | undefined {
  const isPageIndexHit =
    typeof result.id === 'string' &&
    result.id.startsWith('pageindex-') &&
    result.metadata?.sourceType === 'pageindex';
  if (!isPageIndexHit) return undefined;
  const url = result.metadata?.storageUrl;
  // A private reference of the bucket content is no link. The citation points
  // to the route of the document instead, which hands out a signed address to
  // the person who may see it (the chat opens it with the session).
  if (typeof url === 'string' && url.startsWith('private://content/')) {
    const match = PAGEINDEX_ID.exec(typeof result.id === 'string' ? result.id : '');
    return match ? `/api/documents/${match[1]}/file` : undefined;
  }
  // only a web address: no javascript: or data: URL reaches a link
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : undefined;
}
