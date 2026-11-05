/**
 * @jest-environment node
 */

// Recognition of the requests for content: course, enabler, use case, scenario,
// document ("Öffne den Kurs ...", "Zeig mir das PDF zum Enabler ...", "Öffne das
// Dokument Szenario_14i", "das PDF dazu"). Typed and spoken, with and without
// umlauts and punctuation.

import {
  detectNavigationIntent,
  isDirectCommand,
} from '@/lib/hai/navigation/intent';

jest.mock('@/db', () => ({ __esModule: true, default: {} }));
jest.mock('@/db/haiDb', () => ({ __esModule: true, default: {} }));

const kindOf = (message: string) => detectNavigationIntent(message)?.kind;

describe('documents of an enabler or use case', () => {
  const PARENT_SENTENCES: Array<[string, 'enabler' | 'use_case', string]> = [
    ['Öffne das Szenario zu Enabler 3', 'enabler', 'scenario'],
    ['Oeffne das Szenario zu Enabler 3.', 'enabler', 'scenario'],
    ['öffne das szenario zum enabler datensicherung', 'enabler', 'scenario'],
    ['Zeig mir das PDF zum Enabler Normalisierung', 'enabler', 'any'],
    ['Zeig mir das PDF zum Enabler Normalisierung!', 'enabler', 'any'],
    ['Wo finde ich das Szenario zu Enabler 3?', 'enabler', 'scenario'],
    [
      'Wo finde ich das Szenario zum Enabler Datensicherung',
      'enabler',
      'scenario',
    ],
    ['Bring mich zum Szenario von Enabler drei', 'enabler', 'scenario'],
    ['Öffne die Unterlagen zu Enabler 2', 'enabler', 'theory'],
    ['Öffne den Lehrtext zum Enabler SQL Grundlagen', 'enabler', 'theory'],
    ['Öffne das Material zu Enabler 5', 'enabler', 'theory'],
    ['Lies das Dokument zu Enabler 4', 'enabler', 'any'],
    ['Öffne die Aufgabe zum Use Case Bestellsystem', 'use_case', 'task'],
    ['Zeig mir das PDF zum Use Case Bestellsystem', 'use_case', 'any'],
    ['Öffne das Dokument zum Use Case 2', 'use_case', 'any'],
    ['Oeffne die Datei zum Use Case Bestellsystem bitte', 'use_case', 'any'],
    [
      'Öffne das Szenario zum Themenkreis Datensicherung',
      'enabler',
      'scenario',
    ],
    ['Enabler 3 Szenario öffnen', 'enabler', 'scenario'],
  ];

  it.each(PARENT_SENTENCES)(
    '"%s" names the %s and asks for the kind %s',
    (message, type, docKind) => {
      const intent = detectNavigationIntent(message);
      expect(intent).toMatchObject({
        kind: 'document',
        docKind,
        parent: { type },
        demonstrative: false,
      });
    }
  );

  it('reads the number or the name of the parent', () => {
    expect(
      detectNavigationIntent('Öffne das Szenario zu Enabler 3')
    ).toMatchObject({ parent: { ref: { number: '3' } } });
    expect(
      detectNavigationIntent('Öffne das Szenario zum Enabler Datensicherung')
    ).toMatchObject({ parent: { ref: { name: 'datensicherung' } } });
    expect(
      detectNavigationIntent('Bring mich zum Szenario von Enabler drei')
    ).toMatchObject({ parent: { ref: { number: '3' } } });
  });

  it('a document word after the NAME of an enabler is part of its title', () => {
    expect(
      detectNavigationIntent('Öffne den Enabler Szenario Planung')
    ).toEqual({ kind: 'enabler', ref: { name: 'szenario planung' } });
  });
});

describe('a document by its file name', () => {
  it.each([
    'Öffne das Dokument Szenario_14i',
    'öffne das dokument szenario 14i',
    'Zeig mir das PDF Szenario_14i_Datensicherung.pdf',
    'Öffne die Datei Datenbank_Grundlagen.pdf',
    'Lies das Dokument Datenbank Grundlagen',
    'Öffne das Szenario K14-i',
    'Öffne das Szenario 14i',
  ])('"%s" is a document by name', message => {
    const intent = detectNavigationIntent(message);
    expect(intent).toMatchObject({ kind: 'document', parent: null });
    expect(
      intent && intent.kind === 'document' ? intent.fileKeys.length : 0
    ).toBeGreaterThan(0);
  });

  it('keeps the words of an enabler title out of the file name', () => {
    const intent = detectNavigationIntent(
      'Zeig mir das PDF zum Enabler Datenbank Grundlagen'
    );
    expect(intent).toMatchObject({ kind: 'document', fileKeys: [] });
  });
});

describe('"this file" and the follow-ups', () => {
  it.each([
    'Öffne diese Datei',
    'Öffne das PDF',
    'Zeig mir das Dokument',
    'Öffne das Szenario',
    'Lies das Dokument bitte',
    'Öffne das PDF dazu',
    'dann öffne das Szenario',
    'und das PDF dazu',
    'das Szenario dazu bitte',
  ])(
    '"%s" points at the document of the page or of the last turns',
    message => {
      expect(detectNavigationIntent(message)).toMatchObject({
        kind: 'document',
        demonstrative: true,
        parent: null,
      });
    }
  );

  it('a plural asks for a list and stays with the file questions', () => {
    expect(
      detectNavigationIntent('Zeig mir bitte die KFBM Szenarien.')
    ).toBeNull();
    expect(detectNavigationIntent('Zeig mir die Dokumente')).toBeNull();
  });

  it('is no document request when it is a question about the platform or the word', () => {
    expect(
      detectNavigationIntent('Wie öffne ich eine Datei in Python?')
    ).toBeNull();
    expect(detectNavigationIntent('Was ist ein Szenario?')).toBeNull();
    expect(detectNavigationIntent('Erkläre mir das Dokument')).toBeNull();
  });
});

describe('courses', () => {
  it.each([
    ['Öffne den Kurs Datenbanken', { name: 'datenbanken' }],
    ['Zum Kurs Reisekosten bitte', { name: 'reisekosten' }],
    ['Bring mich zum Kurs Netzwerke', { name: 'netzwerke' }],
    ['öffne den kurs netzwerke und sicherheit', { name: 'netzwerke' }],
    ['Geh zum Modul 2', { number: '2' }],
    ['Öffne den Kurs drei', { number: '3' }],
  ])('"%s" is a course', (message, ref) => {
    expect(detectNavigationIntent(message)).toEqual({ kind: 'course', ref });
  });

  it('"meine Kurse" is the page Lernen, a course without a name too', () => {
    expect(detectNavigationIntent('Öffne meine Kurse')).toEqual({
      kind: 'static',
      target: 'courses',
    });
    expect(detectNavigationIntent('Öffne den Kurs')).toEqual({
      kind: 'course',
      ref: {},
    });
  });
});

describe('a command without a target is answered by the platform', () => {
  it.each([
    'Öffne die Kantine',
    'Öffne die Speisekarte',
    'Geh zur Gehaltsabrechnung',
    'öffne den Use Case',
    'Öffne den Enabler',
  ])('"%s" is an unmatched command', message => {
    expect(kindOf(message)).toBe('unmatched');
  });

  it('is never raised for a follow-up, a question, an idiom or a path', () => {
    expect(detectNavigationIntent('öffne die Seite')).toBeNull();
    expect(detectNavigationIntent('Geh bitte auf meine Frage ein.')).toBeNull();
    expect(detectNavigationIntent('öffne die Seite /admin/secret')).toBeNull();
    expect(detectNavigationIntent('Zeig mir den Enabler')).toBeNull();
  });
});

describe('new pages', () => {
  it.each([
    ['Öffne die Wochenbewertung', 'evaluations'],
    ['Geh zu den Wochenbewertungen', 'evaluations'],
    ['Bring mich zum Arbeitszeugnis', 'certificate'],
    ['Öffne das Azubi-Arbeitszeugnis', 'certificate'],
    ['Öffne den Inhalts-Import', 'content_upload'],
    ['Öffne die HAI-Verwaltung', 'hai_admin'],
    ['Öffne das HAI-Gedächtnis', 'hai_memory'],
  ])('"%s" is the page %s', (message, target) => {
    expect(detectNavigationIntent(message)).toEqual({ kind: 'static', target });
  });
});

describe('how it was said', () => {
  it('"Zeig mir" and "Lies" are no question for the way', () => {
    expect(isDirectCommand('Lies das Dokument Szenario_14i')).toBe(true);
    expect(isDirectCommand('Öffne das Dokument Szenario_14i')).toBe(true);
    expect(isDirectCommand('Wo finde ich das Szenario zu Enabler 3?')).toBe(
      false
    );
  });
});
