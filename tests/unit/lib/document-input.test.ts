/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import { contentDocumentType } from '@/db/migrations/schemas/schema';
import {
  DOCUMENT_TYPES,
  MAX_DOCUMENT_FILE_NAME_LENGTH,
  MAX_DOCUMENT_TITLE_LENGTH,
  invalidDocumentInput,
} from '@/lib/document-input';

// What the document routes accept for title, fileName, mimeType and
// documentType. An invalid value is a 400 with the name of the field, never a
// 500 from the database and never the value itself in the answer.

const valid = {
  title: 'Skript',
  fileName: '1700000000000_skript.pdf',
  mimeType: 'application/pdf',
  documentType: 'THEORY',
};

async function problem(extra: Record<string, unknown>) {
  const res = invalidDocumentInput({ ...valid, ...extra });
  if (!res) return null;
  return { status: res.status, body: (await res.json()) as { error: string } };
}

describe('invalidDocumentInput', () => {
  it('accepts valid input', () => {
    expect(invalidDocumentInput(valid)).toBeNull();
  });

  it('accepts the optional fields when they are absent', () => {
    expect(invalidDocumentInput({ title: 'a', fileName: 'b.pdf' })).toBeNull();
    expect(
      invalidDocumentInput({
        title: 'a',
        fileName: 'b.pdf',
        mimeType: null,
        documentType: '',
      })
    ).toBeNull();
  });

  it('knows exactly the values of the database enum', () => {
    expect([...DOCUMENT_TYPES]).toEqual([...contentDocumentType.enumValues]);
    for (const documentType of contentDocumentType.enumValues) {
      expect(invalidDocumentInput({ ...valid, documentType })).toBeNull();
    }
  });

  describe('title', () => {
    it('accepts 1 to 255 characters, also with umlauts', async () => {
      expect(await problem({ title: 'ä' })).toBeNull();
      expect(
        await problem({ title: 'x'.repeat(MAX_DOCUMENT_TITLE_LENGTH) })
      ).toBeNull();
      expect(await problem({ title: 'Übung 1: Größe & Maß' })).toBeNull();
    });

    it.each([
      ['empty', ''],
      ['blank', '   '],
      ['too long', 'x'.repeat(MAX_DOCUMENT_TITLE_LENGTH + 1)],
      ['a number', 5],
      ['an object', { a: 1 }],
      ['an array', ['a']],
      ['null', null],
      ['undefined', undefined],
      ['a NUL character', 'a\u0000b'],
    ])('refuses %s', async (_name, title) => {
      const result = await problem({ title });
      expect(result?.status).toBe(400);
      expect(result?.body.error).toMatch(/^title /);
    });
  });

  describe('fileName', () => {
    it('accepts a file name with spaces, dots and umlauts up to 255 characters', async () => {
      expect(await problem({ fileName: 'Lösung Aufgabe 1 (neu).v2.pdf' })).toBeNull();
      expect(
        await problem({ fileName: 'x'.repeat(MAX_DOCUMENT_FILE_NAME_LENGTH) })
      ).toBeNull();
    });

    it.each([
      ['empty', ''],
      ['too long', 'x'.repeat(MAX_DOCUMENT_FILE_NAME_LENGTH + 1)],
      ['a slash', 'a/b.pdf'],
      ['a path to the parent', '../secret.pdf'],
      ['a backslash', 'a\\b.pdf'],
      ['a windows path', 'C:\\Windows\\win.ini'],
      ['a dot name', '.'],
      ['a dot dot name', '..'],
      ['a NUL character', 'a\u0000.pdf'],
      ['a line break', 'a\n.pdf'],
      ['a control character', 'a\u0007.pdf'],
      ['a number', 1],
      ['an object', {}],
      ['null', null],
      ['undefined', undefined],
    ])('refuses %s', async (_name, fileName) => {
      const result = await problem({ fileName });
      expect(result?.status).toBe(400);
      expect(result?.body.error).toMatch(/^fileName /);
    });
  });

  describe('mimeType', () => {
    it.each([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain',
    ])('accepts %s', async mimeType => {
      expect(await problem({ mimeType })).toBeNull();
    });

    it.each([
      ['html', 'text/html'],
      ['javascript', 'application/javascript'],
      ['svg, which can carry scripts', 'image/svg+xml'],
      ['an executable', 'application/x-msdownload'],
      ['a wildcard', '*/*'],
      ['an image wildcard', 'image/*'],
      ['a type with parameters', 'application/pdf; charset=utf-8'],
      ['an unknown type', 'application/x-evil'],
      ['a prefix only', 'application/vnd.openxmlformats-officedocument.'],
      ['a line break', 'application/pdf\nx'],
      ['a number', 5],
      ['an object', {}],
    ])('refuses %s', async (_name, mimeType) => {
      const result = await problem({ mimeType });
      expect(result?.status).toBe(400);
      expect(result?.body.error).toMatch(/^mimeType /);
    });
  });

  describe('documentType', () => {
    it.each([
      ['an unknown value', 'SECRET'],
      ['a lower case value', 'theory'],
      ['a value with blanks', ' THEORY'],
      ['an sql fragment', "THEORY'; DROP TABLE content_documents;--"],
      ['a number', 1],
      ['an object', { a: 1 }],
      ['an array', ['THEORY']],
      ['true', true],
    ])('refuses %s', async (_name, documentType) => {
      const result = await problem({ documentType });
      expect(result?.status).toBe(400);
      expect(result?.body.error).toMatch(/^documentType /);
      expect(result?.body.error).toContain('TRAINER_SOLUTION');
    });
  });

  it('never repeats the value in the answer', async () => {
    const result = await problem({ documentType: 'LEAKY_VALUE_123' });
    expect(result?.body.error).not.toContain('LEAKY_VALUE_123');
  });

  it('reports the first problem, in the order title, fileName, mimeType, documentType', async () => {
    const result = await problem({
      title: '',
      fileName: '',
      mimeType: 'x',
      documentType: 'x',
    });
    expect(result?.body.error).toMatch(/^title /);
    const second = await problem({ fileName: '', mimeType: 'x' });
    expect(second?.body.error).toMatch(/^fileName /);
  });
});
