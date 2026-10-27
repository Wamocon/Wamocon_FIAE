/**
 * Shape checks for what the document routes take from the body: title,
 * fileName, mimeType and documentType. Before, only the storage url was
 * checked: a document type that is no value of the database enum made the
 * insert fail with a 500, and the other fields were stored as sent.
 *
 * An invalid value is a 400 with the name of the field and the rule, never the
 * value itself.
 */

import { NextResponse } from 'next/server';
import { contentDocumentType } from '@/db/migrations/schemas/schema';

/** Values of the database enum content_document_type. */
export const DOCUMENT_TYPES: readonly string[] =
  contentDocumentType.enumValues;

export const MAX_DOCUMENT_TITLE_LENGTH = 255;
export const MAX_DOCUMENT_FILE_NAME_LENGTH = 255;

/**
 * File types of a document: PDF (the uploader sends PDF only), Office Open
 * XML, plain text and images. Images without SVG: an SVG can carry scripts.
 */
const ALLOWED_MIME_TYPES: readonly RegExp[] = [
  /^application\/pdf$/,
  /^application\/vnd\.openxmlformats-officedocument\.[a-z0-9.+-]{1,100}$/,
  /^image\/(?!svg)[a-z0-9.+-]{1,50}$/,
  /^text\/plain$/,
];

/** NUL, other control characters and DEL. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type DocumentInput = {
  title?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  documentType?: unknown;
};

const absent = (value: unknown) =>
  value === undefined || value === null || value === '';

const bad = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

/** A ready-made 400 for the first invalid field, or null. */
export function invalidDocumentInput(
  input: DocumentInput
): NextResponse | null {
  const { title, fileName, mimeType, documentType } = input;

  if (
    typeof title !== 'string' ||
    title.trim() === '' ||
    title.length > MAX_DOCUMENT_TITLE_LENGTH ||
    title.includes('\u0000')
  ) {
    return bad(
      `title must be text of 1 to ${MAX_DOCUMENT_TITLE_LENGTH} characters`
    );
  }

  if (
    typeof fileName !== 'string' ||
    fileName === '' ||
    fileName.length > MAX_DOCUMENT_FILE_NAME_LENGTH ||
    fileName === '.' ||
    fileName === '..' ||
    /[/\\]/.test(fileName) ||
    CONTROL_CHARACTERS.test(fileName)
  ) {
    return bad(
      `fileName must be a file name of 1 to ${MAX_DOCUMENT_FILE_NAME_LENGTH} characters without path separators`
    );
  }

  if (
    !absent(mimeType) &&
    (typeof mimeType !== 'string' ||
      !ALLOWED_MIME_TYPES.some(pattern => pattern.test(mimeType)))
  ) {
    return bad(
      'mimeType must be application/pdf, an Office Open XML type, text/plain or an image type (not SVG)'
    );
  }

  if (
    !absent(documentType) &&
    (typeof documentType !== 'string' || !DOCUMENT_TYPES.includes(documentType))
  ) {
    return bad(`documentType must be one of: ${DOCUMENT_TYPES.join(', ')}`);
  }

  return null;
}
