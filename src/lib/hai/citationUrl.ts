/**
 * URL of a citation. Only a PageIndex hit carries one, and the PageIndex sets
 * storageUrl only for documents that trainees may see (pageIndexService.ts).
 * A hit of the vector index never gets a URL: its metadata is whatever the
 * writer stored and could hold any url or storageUrl (a trainer solution, a
 * foreign link), and the storage bucket is public.
 */

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
  // only a web address: no javascript: or data: URL reaches a link
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return undefined;
  // never a signed address, a query that carries a signature or token, or an
  // address into the private bucket of the model solutions
  if (SECRET_ADDRESS.test(url)) return undefined;
  return url;
}

const SECRET_ADDRESS =
  /\/object\/(?:sign|authenticated)\/|content-solutions|[?&](?:token|signature|x-amz-[a-z-]+|x-goog-[a-z-]+|sig|jwt|apikey|key)=/i;
