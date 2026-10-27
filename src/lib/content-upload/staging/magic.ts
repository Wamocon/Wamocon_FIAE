// The first bytes of an uploaded file (concept 4.3 step 4). The server reads
// them with its own key after the upload and compares them with the extension
// that was announced: a PDF starts with `%PDF-`, a docx is a zip and starts with
// the local file header `PK\x03\x04`. A file that says docx and holds something
// else is rejected and its object deleted.

import type { UploadExt } from '@/lib/content-upload/staging/paths';

/** How many bytes the check needs. */
export const MAGIC_HEAD_BYTES = 8;

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

function startsWith(head: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, i) => head[i] === byte);
}

export function matchesMagic(ext: UploadExt, head: Uint8Array): boolean {
  return ext === 'pdf' ? startsWith(head, PDF) : startsWith(head, ZIP);
}

export function magicRejectionCode(ext: UploadExt): 'NOT_A_PDF' | 'NOT_A_DOCX' {
  return ext === 'pdf' ? 'NOT_A_PDF' : 'NOT_A_DOCX';
}
