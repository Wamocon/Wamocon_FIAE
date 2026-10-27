// The first bytes of an uploaded file (concept 4.3 step 4). The server reads
// them with its own key after the upload and compares them with the extension
// that was announced:
//
//   pdf   starts with `%PDF-`
//   docx  is a zip and starts with the local file header `PK\x03\x04`
//   xlsx  is a zip as well and starts the same way (the content decides later)
//   json  has no signature. A quiz file (schema 1.0) is one JSON object, so after an
//         optional UTF-8 byte order mark and white space (space, tab, line breaks)
//         the first character is `{`. Anything else (an array, a number, text, a
//         zip, HTML) is no quiz file. Whether it is valid UTF-8 and valid JSON is
//         checked by the reader, which has the whole file.
//
// A file that says docx and holds something else is rejected and its object deleted.

import type { UploadExt } from '@/lib/content-upload/staging/paths';

/** How many bytes the check needs (the JSON check skips a byte order mark and white space). */
export const MAGIC_HEAD_BYTES = 64;

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const BOM = [0xef, 0xbb, 0xbf];

function startsWith(head: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, i) => head[i] === byte);
}

/** Space, tab, line feed, carriage return: the white space JSON allows. */
const isJsonSpace = (byte: number) =>
  byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;

function startsLikeJsonObject(head: Uint8Array): boolean {
  let i = startsWith(head, BOM) ? BOM.length : 0;
  while (i < head.length && isJsonSpace(head[i])) i += 1;
  return head[i] === 0x7b;
}

export function matchesMagic(ext: UploadExt, head: Uint8Array): boolean {
  switch (ext) {
    case 'pdf':
      return startsWith(head, PDF);
    case 'json':
      return startsLikeJsonObject(head);
    case 'docx':
    case 'xlsx':
      return startsWith(head, ZIP);
  }
}

export type MagicRejectionCode =
  | 'NOT_A_PDF'
  | 'NOT_A_DOCX'
  | 'NOT_A_JSON'
  | 'NOT_AN_XLSX';

export function magicRejectionCode(ext: UploadExt): MagicRejectionCode {
  switch (ext) {
    case 'pdf':
      return 'NOT_A_PDF';
    case 'json':
      return 'NOT_A_JSON';
    case 'xlsx':
      return 'NOT_AN_XLSX';
    case 'docx':
      return 'NOT_A_DOCX';
  }
}
