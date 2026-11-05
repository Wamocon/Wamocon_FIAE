/**
 * @jest-environment node
 */
import {
  classifyDataIntent,
  historyIsAboutTrainees,
  isLiveDataOnlyTurn,
  isTraineeFollowUpCue,
  resolveDataIntent,
  type HistoryTurnMessage,
} from '@/lib/hai/dataIntent';
import { dataUnavailableLine } from '@/lib/hai/dataContext';

// The short follow-up of a trainer to a question about the own trainees ("Welche
// mit Namen?") carries no noun for trainees and no name. The data intent of such
// a message comes from the history of the session, on the server.

const user = (text: string): HistoryTurnMessage => ({
  role: 'user',
  parts: [{ text }],
});
const model = (text: string): HistoryTurnMessage => ({
  role: 'model',
  parts: [{ text }],
});

/** The chat of the report: the first question asks for the own trainees. */
const AFTER_LIST: HistoryTurnMessage[] = [
  user('Welche Azubis habe ich?'),
  model('Du hast aktuell 5 Auszubildende.'),
];

describe('the question of the report itself', () => {
  it.each([
    'Welche Azubis habe ich?',
    'Zeig mir meine Azubis',
    'Wer sind meine Azubis?',
    'Wie viele Azubis habe ich?',
    'welche azubis habe ich',
    'Welche Auszubildenden betreue ich?',
  ])('%s is the overview of the own trainees', message => {
    expect(resolveDataIntent(message, 'TRAINER', [])).toBe('trainee_overview');
  });
});

describe('isTraineeFollowUpCue', () => {
  it.each([
    'Welche mit Namen?',
    'welche mit namen',
    'Mit Namen bitte',
    'Mit den Namen',
    'Die Namen bitte',
    'Wer genau?',
    'wer genau',
    'Wer davon?',
    'Und welche?',
    'Welche davon?',
    'Und wer?',
    'Wie heißen sie?',
    'Wie heissen die?',
    'Alle anzeigen',
    'Zeig sie mir',
    'Zeig mir alle',
    'Nenn sie mir bitte',
    'Liste sie auf',
    'Und wie viele davon sind in der Schule?',
    'Wie viele davon sind im Betrieb?',
    'Welche davon sind gerade in der Berufsschule?',
    'Und wie stehen sie?',
    'Und die anderen?',
    'Die Liste bitte',
    'Namen?',
  ])('%s is a follow-up', message => {
    expect(isTraineeFollowUpCue(message)).toBe(true);
  });

  it.each([
    'Was ist ein Primärschlüssel?',
    'Erkläre mir bitte, wie ein Join funktioniert und was dabei passiert, wenn die Tabellen leer sind',
    'Welche Quizze gibt es zu Datenbanken?',
    'Wie ist das Wetter?',
    'Hallo',
    'ja',
    'Danke',
    '',
  ])('%s is no follow-up', message => {
    expect(isTraineeFollowUpCue(message)).toBe(false);
  });

  it('a text that is not a string is no follow-up', () => {
    expect(isTraineeFollowUpCue(undefined as unknown as string)).toBe(false);
  });
});

describe('resolveDataIntent: the follow-up is the list again', () => {
  it.each([
    'Welche mit Namen?',
    'Wer genau?',
    'Mit Namen bitte',
    'Alle anzeigen',
    'Und wie viele davon sind in der Schule?',
    'Zeig sie mir',
  ])('%s after the question for the trainees', message => {
    expect(classifyDataIntent(message, 'TRAINER')).not.toBe('trainee_overview');
    expect(resolveDataIntent(message, 'TRAINER', AFTER_LIST)).toBe(
      'trainee_overview'
    );
  });

  it('looks through a follow-up, a question in between ends the lookup', () => {
    const history = [
      ...AFTER_LIST,
      user('Welche mit Namen?'),
      model('Dazu liegen mir keine Daten vor.'),
      user('Wieso kannst du darauf nicht zugreifen?'),
      model('Ich habe nur Zugriff auf Aktuelle Plattform-Daten.'),
    ];
    expect(resolveDataIntent('Wer genau?', 'TRAINER', history)).not.toBe(
      'trainee_overview'
    );
    expect(
      resolveDataIntent('Wer genau?', 'TRAINER', [
        ...AFTER_LIST,
        user('Welche mit Namen?'),
        model('...'),
      ])
    ).toBe('trainee_overview');
  });

  it('is no follow-up without a list in the history', () => {
    expect(resolveDataIntent('Welche mit Namen?', 'TRAINER', [])).toBe('none');
    expect(resolveDataIntent('Welche mit Namen?', 'TRAINER', undefined)).toBe(
      'none'
    );
    expect(
      resolveDataIntent('Welche mit Namen?', 'TRAINER', [
        user('Was ist ein Join?'),
        model('Ein Join verbindet Tabellen.'),
      ])
    ).toBe('none');
  });

  it('never changes the data of a trainee', () => {
    expect(resolveDataIntent('Welche mit Namen?', 'TRAINEE', AFTER_LIST)).toBe(
      classifyDataIntent('Welche mit Namen?', 'TRAINEE')
    );
  });

  it('leaves an intent with its own subject alone', () => {
    expect(
      resolveDataIntent('Wie steht Anna Schmidt?', 'TRAINER', AFTER_LIST)
    ).toBe('trainee_detail_query');
    expect(
      resolveDataIntent('Was muss ich noch bewerten?', 'TRAINER', AFTER_LIST)
    ).toBe('review_query');
  });

  it('looks only at the last questions of the person', () => {
    const old = [
      ...AFTER_LIST,
      user('Was ist ein Join?'),
      model('...'),
      user('Und ein Index?'),
      model('...'),
      user('Und ein Primärschlüssel?'),
      model('...'),
      user('Und ein Fremdschlüssel?'),
      model('...'),
    ];
    expect(historyIsAboutTrainees(old)).toBe(false);
  });
});

describe('isLiveDataOnlyTurn: no knowledge sources under a list of trainees', () => {
  it.each([
    'Welche Azubis habe ich?',
    'Zeig mir meine Azubis',
    'Wer sind meine Azubis?',
    'Wie viele Azubis habe ich?',
    'Wie stehen meine Azubis?',
    'Alle Azubis anzeigen',
    'Auszubildende anzeigen',
    'Azubis auflisten',
  ])('%s is answered from the live data', message => {
    expect(isLiveDataOnlyTurn(message, 'TRAINER', [])).toBe(true);
  });

  it('counts the follow-up of a list, but not without the list', () => {
    expect(isLiveDataOnlyTurn('Welche mit Namen?', 'TRAINER', AFTER_LIST)).toBe(
      true
    );
    expect(isLiveDataOnlyTurn('Welche mit Namen?', 'TRAINER', [])).toBe(false);
  });

  it('counts the open reviews in plain words', () => {
    expect(isLiveDataOnlyTurn('Was muss ich noch bewerten?', 'TRAINER')).toBe(
      true
    );
    expect(isLiveDataOnlyTurn('Zeig mir offene Abgaben', 'TRAINER')).toBe(true);
  });

  it.each([
    'Prüfe diesen SQL-Befehl',
    'Welche Aufgaben gebe ich meinen Azubis zu Joins?',
    'Welche Fragen kann ich meinem Azubi stellen?',
    'Erkläre mir, wie ich meinen Azubis Normalisierung beibringe',
    'Was ist ein Quiz für Azubis?',
    'Welche Quizze gibt es für meine Azubis?',
    'Zeig mir das Szenario Kundenanfrage und den Hinweis dazu.',
    'Was ist ein Primärschlüssel?',
  ])('%s keeps its search and its sources', message => {
    expect(isLiveDataOnlyTurn(message, 'TRAINER', [])).toBe(false);
  });

  it('a long text is a question of its own', () => {
    expect(
      isLiveDataOnlyTurn(
        'Welche Azubis habe ich und kannst du mir dazu bitte noch einiges mehr erzählen, was mich als Ausbilder interessieren könnte?',
        'TRAINER'
      )
    ).toBe(false);
  });

  it('is only for a trainer', () => {
    expect(isLiveDataOnlyTurn('Welche Azubis habe ich?', 'TRAINEE')).toBe(
      false
    );
    expect(isLiveDataOnlyTurn('Welche Azubis habe ich?', undefined)).toBe(
      false
    );
  });
});

describe('dataUnavailableLine: a failed list is said plainly', () => {
  it('names the list, says technical failure and forbids a number or a name', () => {
    const text = dataUnavailableLine('trainee_overview');
    expect(text).toContain('Die Liste konnte gerade nicht geladen werden');
    expect(text).toContain('technische Störung');
    expect(text).toContain('keine fehlende Berechtigung');
    expect(text).toContain('keine Zahlen, Namen oder Werte');
    expect(text).not.toMatch(/[–—]/);
  });

  it('has a general line for the other intents', () => {
    expect(dataUnavailableLine('review_query')).toContain(
      'Die Daten zu dieser Frage konnten gerade nicht geladen werden'
    );
  });
});
