'use client';

/**
 * The document a link of the HAI asks the page to open (`?document=<uuid>`).
 *
 * The value is only an id. A page that reads it opens the document in its
 * reader only when that document is in the list the page itself shows for the
 * person (the lists apply the access rules of the document routes), otherwise it
 * shows the neutral note "Die Datei wurde nicht gefunden." The note is the same
 * for a document that does not exist and one the person may not see.
 *
 * Strict (see documentIdFromSearch in targets.ts): only the known parameters, each
 * once, and the value has to be a uuid, so a crafted link opens nothing.
 *
 * @module lib/hai/navigation/useDocumentParam
 */

import * as navigation from 'next/navigation';
import { documentIdFromSearch, enablerIdFromSearch } from './targets';

type SearchParamsLike = URLSearchParams | null;

// A test double of next/navigation may not know the hook: then there is no parameter
const useSearch =
  (navigation as unknown as { useSearchParams?: () => SearchParamsLike })
    .useSearchParams ?? (() => null);

/** The uuid in `document`, or null. */
export function useDocumentParam(): string | null {
  return documentIdFromSearch(useSearch());
}

/** The uuids in `enabler` and `document` of the trainer editor, or null each. */
export function useEditorParams(): {
  enablerId: string | null;
  documentId: string | null;
} {
  const search = useSearch();
  return {
    enablerId: enablerIdFromSearch(search),
    documentId: documentIdFromSearch(search),
  };
}
