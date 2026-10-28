// The original PDF of an enabler text can go with the transfer to the document bucket, so the
// trainees read it in the reader of the enabler page (package OR1, docs/ki-upload-konzept.md 8.5).
// The person marks the files in the review list. This module decides which rows can be marked and
// keeps the mark within the limit. The transfer checks every file again (transfer/originals.ts) and
// refuses what does not fit, so this is a convenience for the person and no protection.
//
// Small and without imports of the server side, so the page of the browser can use it too.

import { DECIDABLE } from '@/lib/content-upload/review/states';
import type { ReviewRowDto } from '@/lib/content-upload/review/types';

/** Most originals one apply can take (the same limit as the route, transfer/request.ts). */
export const MAX_ORIGINALS = 25;

/**
 * The rows that can be marked: an accepted PDF that was assigned as the original of an enabler
 * text (type pdf_original with an enabler). Word files are not offered: the reader of the trainees
 * opens PDF files only.
 */
export function originalCandidates(
  rows: readonly ReviewRowDto[]
): ReviewRowDto[] {
  return rows.filter(
    row =>
      row.ext === 'pdf' &&
      row.decision?.action === 'accept' &&
      DECIDABLE.includes(row.status) &&
      row.effective.docType === 'pdf_original' &&
      Boolean(row.effective.enablerCode)
  );
}

/** The selection with one file marked or unmarked. The limit is never exceeded. */
export function toggleOriginal(
  selected: ReadonlySet<string>,
  id: string,
  on: boolean
): Set<string> {
  if (on && !selected.has(id) && selected.size >= MAX_ORIGINALS) {
    return selected as Set<string>;
  }
  const next = new Set(selected);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}
