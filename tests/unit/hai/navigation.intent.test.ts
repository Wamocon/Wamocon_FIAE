/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { detectNavigationIntent } from '@/lib/hai/navigation/intent';
import { foldText } from '@/lib/hai/navigation/fold';
import {
  isOpenConfirmation,
  isOpenDecline,
} from '@/lib/hai/navigation/confirm';

// Deterministic recognition of a navigation request (agent layer). Keywords on
// folded text like the data intents: a typed or spoken umlaut meets the keyword
// without it. A request needs a cue and a target, a learning question, a request
// for a solution and a question for numbers stay with the pipeline.

describe('detectNavigationIntent: the examples of the owner', () => {
  it.each([
    ['öffne meine Berichte', { kind: 'static', target: 'activity_reports' }],
    [
      'bring mich zum Quiz von Enabler 3',
      { kind: 'enabler_quiz', ref: { number: '3' } },
    ],
    ['wo geht es weiter', { kind: 'continue' }],
    ['zeig mir die Berufsschule', { kind: 'static', target: 'school' }],
    ['geh zur Statistik', { kind: 'static', target: 'statistics' }],
  ])('%s', (message, expected) => {
    expect(detectNavigationIntent(message)).toEqual(expected);
  });
});

describe('detectNavigationIntent: umlauts and spoken forms', () => {
  it('reads "öffne" typed with the umlaut, as "oeffne" and in capitals', () => {
    for (const message of [
      'öffne meinen Kalender',
      'oeffne meinen Kalender',
      'ÖFFNE MEINEN KALENDER',
      'Kannst du mir bitte den Kalender öffnen?',
    ]) {
      expect(detectNavigationIntent(message)).toEqual({
        kind: 'static',
        target: 'calendar',
      });
    }
  });

  it('reads "führ mich" and "für" with and without umlauts', () => {
    expect(detectNavigationIntent('Führ mich zur Berufsschule')).toEqual({
      kind: 'static',
      target: 'school',
    });
    expect(detectNavigationIntent('fuehr mich zur Berufsschule')).toEqual({
      kind: 'static',
      target: 'school',
    });
  });

  it('understands the spoken ways to ask where it goes on', () => {
    for (const message of [
      'Wo geht es weiter?',
      'wo gehts weiter',
      'Wie geht es jetzt weiter?',
      'ich möchte weiter lernen',
      'weiterlernen',
      'Was soll ich als nächstes lernen?',
      'Was ist mein nächster Schritt?',
      'Womit mache ich weiter?',
    ]) {
      expect(detectNavigationIntent(message)).toEqual({ kind: 'continue' });
    }
  });

  it.each([
    ['Öffne das Dashboard', 'dashboard'],
    ['geh bitte zu meinem Profil', 'profile'],
    ['Ich möchte zum Ausbildungsnachweis', 'activity_reports'],
    ['öffne mein Berichtsheft', 'activity_reports'],
    ['öffne die Tätigkeitsnachweise', 'activity_reports'],
    ['wo finde ich den Blockkalender', 'calendar'],
    ['Wie komme ich zur Berufsschule?', 'school'],
    ['bring mich zu den Auszubildenden', 'trainees'],
    ['öffne die Berichte der Azubis', 'activity_reports'],
    ['geh zu den offenen Bewertungen', 'reviews'],
    ['öffne die Inhaltsverwaltung', 'content_management'],
    ['öffne die Quizze', 'quizzes'],
    ['öffne die Organisationen', 'organizations'],
    ['öffne die Benutzerverwaltung', 'users'],
  ])('%s -> %s', (message, target) => {
    expect(detectNavigationIntent(message)).toEqual({
      kind: 'static',
      target,
    });
  });
});

describe('detectNavigationIntent: enablers and use cases by number or name', () => {
  it.each([
    ['öffne Enabler 3', { kind: 'enabler', ref: { number: '3' } }],
    ['öffne den Enabler 1a', { kind: 'enabler', ref: { number: '1a' } }],
    ['geh zu Enabler 5.3', { kind: 'enabler', ref: { number: '5.3' } }],
    ['öffne Enabler Nr. 7', { kind: 'enabler', ref: { number: '7' } }],
    [
      'öffne den Enabler SQL Grundlagen bitte',
      { kind: 'enabler', ref: { name: 'sql grundlagen' } },
    ],
    [
      'bring mich zum Enabler Normalisierung',
      { kind: 'enabler', ref: { name: 'normalisierung' } },
    ],
    ['öffne den Use Case 4a', { kind: 'use_case', ref: { number: '4a' } }],
    [
      'zeig mir den Use Case Bestellsystem',
      { kind: 'use_case', ref: { name: 'bestellsystem' } },
    ],
    [
      'öffne den Use-Case Reisekostenabrechnung',
      { kind: 'use_case', ref: { name: 'reisekostenabrechnung' } },
    ],
    [
      'bring mich zum Quiz zum Enabler Normalisierung',
      { kind: 'enabler_quiz', ref: { name: 'normalisierung' } },
    ],
    [
      'öffne das Quiz von Enabler 1a',
      { kind: 'enabler_quiz', ref: { number: '1a' } },
    ],
  ])('%s', (message, expected) => {
    expect(detectNavigationIntent(message)).toEqual(expected);
  });

  it('reads "namens" and "mit dem Namen" as the name of the record', () => {
    expect(
      detectNavigationIntent('öffne den Enabler namens SQL Grundlagen')
    ).toEqual({
      kind: 'enabler',
      ref: { name: 'sql grundlagen' },
    });
    expect(
      detectNavigationIntent('öffne den Use Case mit dem Namen Bestellsystem')
    ).toEqual({ kind: 'use_case', ref: { name: 'bestellsystem' } });
  });

  it('leaves a topic to the pipeline: "zur Anwendungsentwicklung" is no name', () => {
    expect(
      detectNavigationIntent('Zeig mir den Use Case zur Anwendungsentwicklung')
    ).toBeNull();
    expect(
      detectNavigationIntent('öffne den Enabler zum Thema SQL')
    ).toBeNull();
  });

  it('needs a number or a name: "den Use Case" alone is no request', () => {
    expect(detectNavigationIntent('öffne den Use Case')).toBeNull();
    expect(detectNavigationIntent('zeig mir den Enabler')).toBeNull();
  });
});

describe('detectNavigationIntent: what stays with the pipeline', () => {
  it.each([
    'Erkläre mir den Enabler Normalisierung',
    'Was ist ein Enabler?',
    'Gib mir die Musterlösung zum Use Case Bestellsystem',
    'Zeig mir die Lösung der Aufgabe',
    'Wie viele Berichte habe ich?',
    'Welche Note habe ich in der Berufsschule?',
    'Wann ist die nächste Prüfung in der Berufsschule?',
    'Wie ist mein Fortschritt im Quiz?',
    'Teste mich zur Beschaffung mit einer Quizfrage',
    'Quiz starten',
    'Erstelle einen Tätigkeitsnachweis für KW 12',
    'Hallo',
    'Wie öffne ich eine Datei in Python?',
    'Schreibe mir ein Programm, das den Kalender öffnet und Code ausgibt',
    '',
  ])('%s', message => {
    expect(detectNavigationIntent(message)).toBeNull();
  });

  it('does not treat a long text as a command', () => {
    const long = `öffne meine Berichte ${'und noch ein langer Satz '.repeat(10)}`;
    expect(long.length).toBeGreaterThan(160);
    expect(detectNavigationIntent(long)).toBeNull();
  });

  it('returns null for something that is not a string', () => {
    expect(detectNavigationIntent(undefined as unknown as string)).toBeNull();
  });

  it('has a target for no free text: a made up page is no request', () => {
    expect(detectNavigationIntent('öffne die Seite /admin/secret')).toBeNull();
    expect(detectNavigationIntent('geh zu https://example.com')).toBeNull();
  });
});

describe('detectNavigationIntent: the golden set is not hijacked', () => {
  // None of the questions of the golden set (solutions, other occupations,
  // off-topic, allowed answers) may turn into a navigation, except the cases
  // of the navigation group
  const set = JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        'tests',
        'unit',
        'hai',
        'golden',
        'hai-golden-set.json'
      ),
      'utf-8'
    )
  ) as { cases: Array<{ id: string; question: string }> };

  it('recognizes no navigation in the questions of the existing cases', () => {
    const hijacked = set.cases
      .filter(c => !c.id.startsWith('NV-'))
      .filter(c => detectNavigationIntent(c.question) !== null)
      .map(c => c.id);
    expect(hijacked).toEqual([]);
  });
});

describe('foldText', () => {
  it('folds umlauts, drops punctuation and keeps a full stop in a number', () => {
    expect(foldText('Öffne „Enabler 5.3“, bitte!  Für mich.')).toBe(
      'oeffne enabler 5.3 bitte fuer mich'
    );
  });
});

describe('the reply to "Soll ich sie öffnen?"', () => {
  it.each([
    'ja',
    'Ja.',
    'Ja, bitte',
    'ja gerne',
    'öffnen',
    'Öffne sie',
    'oeffne die Seite',
    'mach auf',
    'okay',
    'klar',
    'Ja bitte jetzt',
  ])('%s opens it', text => {
    expect(isOpenConfirmation(text)).toBe(true);
    expect(isOpenDecline(text)).toBe(false);
  });

  it.each(['nein', 'Nein danke', 'lieber nicht', 'abbrechen', 'nicht jetzt'])(
    '%s drops it',
    text => {
      expect(isOpenDecline(text)).toBe(true);
      expect(isOpenConfirmation(text)).toBe(false);
    }
  );

  it.each([
    'ja und was ist ein Primärschlüssel',
    'öffne die Berufsschule',
    'Wann ist die Prüfung?',
    'vielleicht',
    '',
  ])('%s is neither', text => {
    expect(isOpenConfirmation(text)).toBe(false);
    expect(isOpenDecline(text)).toBe(false);
  });
});
