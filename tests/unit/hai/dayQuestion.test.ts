/**
 * @jest-environment node
 */
// Day companion: natural questions about the own tasks, appointments and state
// are recognized without a model (typed and spoken, with and without umlauts),
// a knowledge question with the same words is not.

jest.mock('@/db', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/auth-helpers', () => ({ toHaiRole: jest.fn() }));
jest.mock('@/lib/catalog/scope', () => ({
  getCatalogScopeForUserId: jest.fn(),
}));
jest.mock('@/lib/catalog/phase-plan-db', () => ({ loadPhasePlan: jest.fn() }));

import { classifyDataIntent } from '@/lib/hai/dataContext';
import {
  foldUmlauts,
  isDayBriefingMessage,
  isDayQuestion,
} from '@/lib/hai/dayQuestion';

const DAY_QUESTIONS = [
  // the case of the preview
  'Was steht für mich an?',
  'Was steht fuer mich an?',
  'was steht für mich an',
  'Was liegt für mich an?',
  'Was steht bei mir an?',
  'Was liegt bei mir an',
  'Was steht denn heute so an?',
  'Was steht diese Woche an?',
  'Was steht als Nächstes an?',
  'Was habe ich heute zu tun?',
  'Was habe ich diese Woche zu tun?',
  'Was habe ich in dieser Woche zu erledigen?',
  'Was habe ich vor?',
  'Was habe ich heute vor?',
  'Was muss ich machen?',
  'Was muss ich heute erledigen?',
  'Was muss ich noch tun?',
  'Was soll ich als Nächstes erledigen?',
  'Was ist zu tun?',
  'Was ist offen?',
  'Was ist noch offen?',
  'Was ist heute fällig?',
  'Was ist als Nächstes dran?',
  'Was ist als Naechstes dran',
  'Was sind meine Aufgaben?',
  'Was sind meine nächsten Schritte?',
  'Was sind meine offenen Aufgaben für heute?',
  'Welche Aufgaben habe ich?',
  'Welche Termine stehen an?',
  'Gibt es etwas Neues für mich?',
  'Gibt es was Neues für mich',
  'Habe ich etwas Neues?',
  'Wo stehe ich?',
  'Wo stehe ich gerade in meiner Ausbildung?',
  'Plane meinen Tag',
  'Plane meine Woche',
  'Kannst du meine Woche planen?',
  'Plan mir bitte die Woche',
  'Wie sieht meine Woche aus?',
  'Wie sieht es heute bei mir aus?',
  // with a greeting, a polite frame or a filler, as spoken
  'Hallo, was steht für mich an?',
  'Hey Hai, was steht für mich an',
  'Guten Tag, was habe ich heute zu tun?',
  'Sag mal, was muss ich eigentlich machen?',
  'Kannst du mir sagen, was für mich ansteht?',
  'Was liegt denn bei mir an, bitte?',
  '  WAS STEHT FÜR MICH AN???  ',
  // the old fixed phrases still work
  'Guten Morgen, was steht heute an?',
  'Was steht heute an',
  'Was muss ich heute erledigen?',
  'Mach mir einen Tagesplan',
  'Plan für heute bitte',
  'Mein Wochenplan',
];

const KNOWLEDGE_QUESTIONS = [
  'Was steht in Enabler 3 an?',
  'Was steht im Gesetz an?',
  'Was steht im Vertrag zur Kündigung?',
  'Was muss man bei einer Primärschlüssel-Definition beachten?',
  'Was muss ich bei einer Primärschlüssel-Definition beachten?',
  'Was muss ich tun, um einen Fremdschlüssel zu definieren?',
  'Was muss ich machen, damit der Join funktioniert?',
  'Was soll ich tun, wenn die Verbindung abbricht?',
  'Was habe ich vor Weihnachten gelernt?',
  'Was habe ich bei der Normalisierung falsch gemacht?',
  'Was ist ein offener Standard?',
  'Was ist offen im Sinne von Open Source?',
  'Was ist eine Aufgabe im Scrum?',
  'Was sind meine Aufgaben als Fachinformatiker?',
  'Was sind die Aufgaben eines Product Owners?',
  'Welche Aufgaben hat ein Datenbankadministrator?',
  'Wo stehe ich mit Variablen in Java?',
  'Wie plane ich die Woche vor der Prüfung am besten?',
  'Gibt es etwas Neues in Java 21?',
  'Erkläre mir den Unterschied zwischen INNER JOIN und LEFT JOIN',
  'Was ist ein Primärschlüssel?',
  'Wie funktioniert eine Schleife?',
];

describe('isDayQuestion', () => {
  it.each(DAY_QUESTIONS)('recognizes "%s"', message => {
    expect(isDayQuestion(message)).toBe(true);
  });

  it.each(KNOWLEDGE_QUESTIONS)('does not take "%s" for the day', message => {
    expect(isDayQuestion(message)).toBe(false);
  });

  it('does not take a bare greeting for a question, but for the day', () => {
    expect(isDayQuestion('Guten Morgen!')).toBe(false);
    expect(isDayBriefingMessage('Guten Morgen!')).toBe(true);
    expect(isDayBriefingMessage('Hallo')).toBe(false);
  });

  it('reads the second sentence of a message too', () => {
    expect(isDayQuestion('Danke dir. Was steht für mich an?')).toBe(true);
    expect(isDayQuestion('Erkläre mir JOINs. Was steht im Gesetz an?')).toBe(
      false
    );
  });

  it('folds umlauts the way the keyword lists are written', () => {
    expect(foldUmlauts('FÜR Größe Nächstes')).toBe('fuer groesse naechstes');
  });
});

describe('the data intent for the same questions', () => {
  it.each(DAY_QUESTIONS)('"%s" is the day for a trainee', message => {
    expect(classifyDataIntent(message, 'TRAINEE')).toBe('day_briefing');
  });

  it.each(DAY_QUESTIONS.filter(m => !/Wo stehe ich|Fortschritt/.test(m)))(
    '"%s" is the day for a trainer too',
    message => {
      expect(classifyDataIntent(message, 'TRAINER')).toBe('day_briefing');
    }
  );

  it('keeps the existing intent where it carries the right data', () => {
    expect(classifyDataIntent('Wie ist mein Fortschritt?', 'TRAINEE')).toBe(
      'progress_query'
    );
    expect(classifyDataIntent('Wie ist mein Stand?', 'TRAINEE')).toBe(
      'progress_query'
    );
    expect(classifyDataIntent('Wie weit bin ich?', 'TRAINEE')).toBe(
      'progress_query'
    );
    expect(
      classifyDataIntent('Habe ich neue Benachrichtigungen?', 'TRAINEE')
    ).toBe('notification_query');
    expect(classifyDataIntent('Habe ich Neuigkeiten?', 'TRAINEE')).toBe(
      'notification_query'
    );
    expect(classifyDataIntent('Was gibt es Neues?', 'TRAINEE')).toBe(
      'notification_query'
    );
    expect(classifyDataIntent('Wann habe ich Berufsschule?', 'TRAINEE')).toBe(
      'calendar_query'
    );
    expect(classifyDataIntent('Welche Abgaben sind offen?', 'TRAINEE')).toBe(
      'submission_query'
    );
  });

  it('knows "Rückmeldungen" with the umlaut as feedback on submissions', () => {
    expect(classifyDataIntent('Habe ich Rückmeldungen?', 'TRAINEE')).toBe(
      'submission_query'
    );
    expect(classifyDataIntent('Habe ich Rueckmeldungen?', 'TRAINEE')).toBe(
      'submission_query'
    );
  });

  it('leaves a trainer review question with the review intent', () => {
    expect(classifyDataIntent('Was muss ich bewerten?', 'TRAINER')).toBe(
      'review_query'
    );
  });

  it.each(
    KNOWLEDGE_QUESTIONS.filter(m => !/Wo stehe ich|Aufgabe|Scrum/.test(m))
  )('"%s" is not the day', message => {
    expect(classifyDataIntent(message, 'TRAINEE')).not.toBe('day_briefing');
    expect(classifyDataIntent(message, 'TRAINER')).not.toBe('day_briefing');
  });
});
