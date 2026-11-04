/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  detectNavigationIntent,
  isDirectCommand,
} from '@/lib/hai/navigation/intent';
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

  it('needs a number or a name: "den Use Case" alone is a command without a target', () => {
    // a command to open it is answered by the platform (nearest pages), never by the model
    expect(detectNavigationIntent('öffne den Use Case')).toEqual({
      kind: 'unmatched',
      query: 'oeffne den use case',
    });
    // a soft wish without a name stays with the pipeline
    expect(detectNavigationIntent('zeig mir den Enabler')).toBeNull();
  });
});

describe('detectNavigationIntent: the ways a person really asks (03.11.2026)', () => {
  it.each([
    ['Kannst du mich zum Berichtsheft bringen?', 'activity_reports'],
    ['kannst du mich zur berufsschule bringen', 'school'],
    ['Mach das Dashboard auf.', 'dashboard'],
    ['Rufe bitte meine Berufsschule auf.', 'school'],
    ['Nimm mich mit zum Dashboard.', 'dashboard'],
    ['Lass uns zum Profil gehen.', 'profile'],
    ['Zum Dashboard bitte.', 'dashboard'],
    ['zurück zur Startseite', 'dashboard'],
    ['Ich möchte meine Berufsschule sehen.', 'school'],
    ['Wo ist das Dashboard?', 'dashboard'],
    ['Wo kann ich meine Berichte sehen?', 'activity_reports'],
    ['Kannst du mir das Dashboard zeigen?', 'dashboard'],
    ['Öffne meine Kurse.', 'courses'],
    ['Bring mich zu meinen Kursen.', 'courses'],
    ['ich will zum lernen', 'courses'],
    ['Zeig mir mein Ausbilder-Feedback.', 'trainer_feedback'],
    ['Öffne das Feedback von meinem Ausbilder.', 'trainer_feedback'],
    // the report wins over the feedback word
    ['Öffne das Feedback zu meinem Bericht.', 'activity_reports'],
    ['Ich will zur Quiz-Übersicht.', 'quizzes'],
  ])('%s', (message, target) => {
    expect(detectNavigationIntent(message)).toEqual({
      kind: 'static',
      target,
    });
  });

  it('reads a spoken number word and the letter before a number', () => {
    for (const [message, number] of [
      ['öffne enabler drei', '3'],
      ['öffne enabler e drei', '3'],
      ['öffne enabler ee drei', '3'],
      ['Öffne Enabler E3', '3'],
      ['Öffne Enabler Nummer zwölf', '12'],
      ['geh zu enabler eins', '1'],
      ['bring mich zum quiz von enabler drei', '3'],
    ] as const) {
      const intent = detectNavigationIntent(message);
      expect(intent).toMatchObject({ ref: { number } });
    }
    expect(detectNavigationIntent('öffne use case vier')).toEqual({
      kind: 'use_case',
      ref: { number: '4' },
    });
  });

  it('does not take the first word of a name for a number word', () => {
    expect(
      detectNavigationIntent('öffne den Enabler Drei-Schichten-Architektur')
    ).toEqual({ kind: 'enabler', ref: { name: 'drei-schichten-architektur' } });
    expect(detectNavigationIntent('öffne den Enabler Excel Basics')).toEqual({
      kind: 'enabler',
      ref: { name: 'excel basics' },
    });
  });

  it('reads "starte das Quiz von Enabler 3" as the quiz page of the enabler', () => {
    expect(detectNavigationIntent('Starte das Quiz von Enabler 3.')).toEqual({
      kind: 'enabler_quiz',
      ref: { number: '3' },
    });
  });

  it.each([
    'Wo finde ich die Benachrichtigungen?',
    'Wo ist der Fehler in meinem Bericht?',
    'Ich habe ein Problem mit dem Dashboard.',
    'Wo finde ich Hilfe bei SQL?',
    'Geh bitte auf meine Frage ein.',
    'Zu welchem Thema gibt es ein Quiz?',
    'Zum Glück habe ich das Berichtsheft schon geschrieben und dann noch mehr',
  ])('%s stays with the pipeline', message => {
    expect(detectNavigationIntent(message)).toBeNull();
  });
});

describe('isDirectCommand: carried out or offered', () => {
  it.each([
    'Öffne den Ausbildungsnachweis.',
    'Bring mich zu den Quizzen.',
    'Geh zum Dashboard.',
    'Gehe zu meinem Profil.',
    'Führe mich bitte zum Quiz.',
    'Leite mich zur Berufsschule weiter.',
    'Navigiere zu Profil.',
    'Wechsle zum Profil.',
    'Spring zum Kalender.',
    'Mach das Dashboard auf.',
    'Rufe bitte meine Berufsschule auf.',
    'Nimm mich mit zum Dashboard.',
    'Lass uns zum Profil gehen.',
    'Kannst du mich zum Berichtsheft bringen?',
    'Kannst du mir das Dashboard öffnen?',
    'Ich will zum Kalender.',
    'Ich möchte zu meinen Berichten.',
    'Zum Dashboard bitte.',
    'Ich will weiterlernen.',
    'Mach mit dem Lernen weiter.',
    'Starte das Quiz von Enabler 3.',
    'öffne bitte mein profil',
    'geh zum dashboard',
  ])('%s is carried out', message => {
    expect(isDirectCommand(message)).toBe(true);
  });

  it.each([
    'Zeig mir meine Berufsschule.',
    'Zeig mir bitte den Blockkalender.',
    'Ich möchte meine Berufsschule sehen.',
    'Kannst du mir das Dashboard zeigen?',
    'Wo finde ich das Berichtsheft?',
    'Wo ist das Dashboard?',
    'Wie komme ich zu meinen Quizzen?',
    'Wo geht es weiter?',
    'Was soll ich als nächstes lernen?',
    'Wie geht es jetzt weiter?',
    'Was ist mein nächster Schritt?',
    'Wo kann ich das Dashboard öffnen?',
    'Wohin muss ich gehen, um die Berichte zu öffnen?',
    'Dashboard',
    'Hallo',
    '',
  ])('%s is only offered', message => {
    expect(isDirectCommand(message)).toBe(false);
  });

  it('is false for something that is not a string and for a long text', () => {
    expect(isDirectCommand(undefined as unknown as string)).toBe(false);
    expect(
      isDirectCommand(`öffne das Dashboard ${'und noch ein Satz '.repeat(12)}`)
    ).toBe(false);
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

describe('detectNavigationIntent: a page that is not known', () => {
  it.each([
    'öffne die Seite Wetter',
    'Öffne bitte die Seite Rezepte',
    'geh zur Seite Horoskop',
    'bring mich zur Seite Fussball',
    'zeig mir die Seite Gewinnspiel',
  ])('%s is a command for an unknown page', message => {
    expect(detectNavigationIntent(message)).toEqual({ kind: 'unknown_page' });
  });

  it.each([
    // no name of a page
    'öffne die Seite',
    'bring mich zur Seite',
    // a page number or a path is no page name
    'zeig mir Seite 5 des Skripts',
    'öffne die Seite /admin/secret',
    // a question or an explanation stays with the pipeline
    'Erkläre mir die Seite Wetter',
    'Was ist die Seite Rezepte?',
    // a long text is no command
    `öffne die Seite Wetter ${'und noch ein langer Satz '.repeat(6)}`,
  ])('%s stays with the pipeline', message => {
    expect(detectNavigationIntent(message)).toBeNull();
  });

  it('keeps a known page a known page', () => {
    expect(detectNavigationIntent('öffne die Seite Berufsschule')).toEqual({
      kind: 'static',
      target: 'school',
    });
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
