// Does a read link of the storage answer? The trainer page opens the link by
// navigating to it. A link that the storage refuses (the storage was
// unavailable, the 503 of WMCNL-2998) used to end in a request that failed in the
// background and a page where nothing happened. One byte is asked for first, so
// the page can say that the attachment could not be loaded.
//
// What cannot be told (the browser refuses to let the page read the answer, no
// network) is not a failure of the link: the caller then opens it as before.

export type ProbeFetch = (
  url: string,
  init: RequestInit
) => Promise<Pick<Response, 'ok' | 'body'>>;

export async function readLinkAnswers(
  url: string,
  fetchImpl: ProbeFetch = (target, init) => fetch(target, init)
): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    });
    // the one byte is not needed
    void response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return true;
  }
}
