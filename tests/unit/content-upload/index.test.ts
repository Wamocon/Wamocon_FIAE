/**
 * @jest-environment node
 */
// The public entry of src/lib/content-upload names the functions of the package
// and nothing that reaches the network, the database or a model.
import { describe, expect, it } from '@jest/globals';

import * as upload from '@/lib/content-upload';

describe('src/lib/content-upload', () => {
  it('exports the readers, the excerpt and the checks', () => {
    expect(Object.keys(upload).sort()).toEqual(
      [
        'EXCERPT_MAX_CHARS',
        'READ_LIMITS',
        'buildExcerpt',
        'customerDocumentClasses',
        'finding',
        'findInstructionText',
        'firstBlocking',
        'foldConfusables',
        'hasSolutionMarker',
        'paragraphsFromText',
        'protectExcerptLines',
        'readDocx',
        'readPdf',
        'redactPersonalData',
        'runPdfWorker',
        'sanitizeExcerptText',
        'scanPdf',
      ].sort()
    );
  });

  it('fixes the limits of the concept (5.4)', () => {
    expect(upload.EXCERPT_MAX_CHARS).toBe(2500);
    expect(upload.READ_LIMITS).toMatchObject({
      maxInputBytes: 25 * 1024 * 1024,
      maxXmlBytes: 16 * 1024 * 1024,
      maxEntries: 2000,
      maxPdfPages: 300,
      maxTextChars: 2 * 1024 * 1024,
      minPdfChars: 50,
    });
    expect(Object.isFrozen(upload.READ_LIMITS)).toBe(true);
  });

  it('keeps a finding and its first blocking code', () => {
    const list = [
      upload.finding('A', 'info', 'a'),
      upload.finding('B', 'blocking', 'b', 2),
      upload.finding('C', 'blocking', 'c'),
    ];
    expect(list[1]).toEqual({
      code: 'B',
      severity: 'blocking',
      message: 'b',
      count: 2,
    });
    expect(upload.firstBlocking(list)).toBe('B');
    expect(upload.firstBlocking([list[0]])).toBeNull();
  });
});
