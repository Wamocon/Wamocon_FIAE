/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  askWhereToText,
  detectNavigationFollowUp,
  lastAnswerOfferedPage,
  targetsFromHistory,
} from '@/lib/hai/navigation/followUp';
import {
  detectNavigationIntent,
  isDirectCommand,
  mentionedTargets,
} from '@/lib/hai/navigation/intent';
import {
  MENU_ENTRY_NAMES,
  isAllowedNavigationPath,
  staticTargetFor,
} from '@/lib/hai/navigation/targets';
import type { HistoryTurnMessage } from '@/lib/hai/dataIntent';

// The follow-up request without a new target ("dann bring mich dahin", "du
// navigierst", "ja"): which page is meant comes from the history of the session,
// on the server. Exactly one page is carried out, none or several are asked
// back. The words for the pages are the real names of the menu.

const user = (text: string): HistoryTurnMessage => ({
  role: 'user',
  parts: [{ text }],
});
const model = (text: string): HistoryTurnMessage => ({
  role: 'model',
  parts: [{ text }],
});

describe('detectNavigationFollowUp: a clear request to be taken there', () => {
  it.each([
    // the chat of the report
    'Ja aber du kannst mich doch durch das System führen?!',
    'Nein du gehst durch das System, also du navigierst und nicht ich!',
    // bring or lead me there
    'dann bring mich dahin',
    'Dann bring mich bitte dorthin',
    'Bring mich hin',
    'führ mich hin',
    'Fuehr mich bitte dahin',
    'führe mich dorthin',
    'leite mich dahin',
    'Kannst du mich dahin bringen?',
    'Kannst du mich bitte dorthin führen',
    'nimm mich mit',
    'Lotse mich dorthin',
    'bring uns dahin',
    // you navigate
    'du navigierst',
    'Du navigierst für mich!',
    'Du führst mich',
    'navigiere du',
    'Navigiere bitte',
    'kannst du mich durch die Plattform führen',
    'Du sollst mich durch das System führen',
    // open the page
    'öffne die Seite',
    'Oeffne die Seite bitte',
    'öffne sie',
    'Öffne sie doch mal',
    'Mach die Seite auf',
    'ruf die Seite auf',
    'ÖFFNE DIE SEITE!',
    // spoken text: no capitals, no punctuation
    'dann bring mich da hin bitte',
    'oeffne die seite jetzt',
  ])('%s', message => {
    expect(detectNavigationFollowUp(message)).toBe('command');
  });
});

describe('detectNavigationFollowUp: a short agreement', () => {
  it.each([
    'ja',
    'Ja',
    'Ja bitte',
    'ja bitte!',
    'Gern',
    'Gerne',
    'ok',
    'Okay',
    'mach das',
    'Ja mach das',
    'Ja, bitte mach das',
    'Klar',
    'los',
    'öffnen',
    'Ja öffnen',
    'dann mach das mal',
  ])('%s', message => {
    expect(detectNavigationFollowUp(message)).toBe('confirm');
  });
});

describe('detectNavigationFollowUp: what is no follow-up', () => {
  it.each([
    'Was ist ein Dashboard?',
    'Erkläre mir bitte, wie du mich durch das System führen kannst',
    'Was ist die Seite Ausbildungsnachweis?',
    'Wie funktioniert die Navigation?',
    'Welche Azubis habe ich?',
    'Welche mit Namen?',
    'Ja das stimmt, ich habe fünf Azubis in diesem Jahr',
    'Danke',
    'Hallo',
    'nein',
    'Schreib mir eine Lösung dahin',
    'Wie viele Berichte habe ich?',
    '',
    'ja '.repeat(40),
  ])('%s', message => {
    expect(detectNavigationFollowUp(message)).toBeNull();
  });

  it('a value that is no text is no follow-up', () => {
    expect(detectNavigationFollowUp(undefined as unknown as string)).toBeNull();
  });
});

describe('detectNavigationIntent: the words for the pages of the trainer', () => {
  it.each([
    'Öffne die Auszubildenden-Übersicht',
    'Oeffne die Auszubildenden Uebersicht',
    'öffne die Azubi-Übersicht',
    'öffne die Azubi Uebersicht',
    'Öffne die Azubiliste',
    'Öffne die Azubi-Liste',
    'Bring mich zu meinen Azubis',
    'Zeig mir meine Azubis',
    'Auszubildende anzeigen, bitte öffne die Seite Auszubildende',
    'Öffne die Auszubildenden',
    'Geh zur Azubi-Verwaltung',
    'öffne die auszubildenden uebersicht',
    'Mach die Azubiliste auf',
  ])('%s opens the trainees', message => {
    expect(detectNavigationIntent(message)).toEqual({
      kind: 'static',
      target: 'trainees',
    });
  });

  it('keeps the direct command for "Öffne ..." and the offer for "Zeig mir ..."', () => {
    expect(isDirectCommand('Öffne die Auszubildenden-Übersicht')).toBe(true);
    expect(isDirectCommand('Zeig mir meine Azubis')).toBe(false);
  });

  it('the menu entry "Lernen" of the trainee is found by its name', () => {
    expect(detectNavigationIntent('Öffne den Bereich Lernen')).toEqual({
      kind: 'static',
      target: 'courses',
    });
  });

  it('"weiter lernen" stays the next step and not the menu entry', () => {
    expect(detectNavigationIntent('Ich will weiter lernen')).toEqual({
      kind: 'continue',
    });
  });

  it('finds the quiz overview of the trainer by its menu name', () => {
    expect(detectNavigationIntent('Öffne die Quiz-Übersicht')).toEqual({
      kind: 'static',
      target: 'quizzes',
    });
  });
});

describe('mentionedTargets', () => {
  it('names every page of a text once, in the order of the priority list', () => {
    expect(
      mentionedTargets(
        'Navigiere auf deinem Dashboard zum Menüpunkt Auszubildenden-Übersicht'
      )
    ).toEqual(['trainees', 'dashboard']);
  });

  it('is empty without a page and for a value that is no text', () => {
    expect(mentionedTargets('Das sind deine Daten')).toEqual([]);
    expect(mentionedTargets('')).toEqual([]);
    expect(mentionedTargets(undefined as unknown as string)).toEqual([]);
  });
});

describe('targetsFromHistory: exactly one page, no page, two pages', () => {
  it('one page: the trainer asked for the own trainees (the platform put the card under the answer)', () => {
    const history = [
      user('Welche Azubis habe ich?'),
      model('Du hast fünf Auszubildende.'),
    ];
    expect(targetsFromHistory(history, 'TRAINER')).toEqual(['trainees']);
    expect(targetsFromHistory(history, 'ADMIN')).toEqual(['trainees']);
  });

  it('one page: found through the follow-up and the questions in between (the chat of the report)', () => {
    const history = [
      user('Welche Azubis habe ich?'),
      model('Du hast aktuell 5 Auszubildende.'),
      user('Welche mit Namen?'),
      model('Dazu liegen mir aktuell keine Daten vor.'),
      user('Wieso kannst du darauf nicht zugreifen?'),
      model('Ich habe nur Zugriff auf Aktuelle Plattform-Daten.'),
    ];
    expect(targetsFromHistory(history, 'TRAINER')).toEqual(['trainees']);
  });

  it('one page: the person named it before', () => {
    expect(
      targetsFromHistory(
        [
          user('Zeig mir meine Berufsschule'),
          model('Ich habe die Seite Berufsschule für dich.'),
        ],
        'TRAINEE'
      )
    ).toEqual(['school']);
  });

  it('one page: the answer names one menu entry', () => {
    expect(
      targetsFromHistory(
        [
          user('Wo trage ich meine Woche ein?'),
          model('Das machst du im Menüpunkt Ausbildungsnachweis.'),
        ],
        'TRAINEE'
      )
    ).toEqual(['activity_reports']);
  });

  it('no page: an empty history, or a talk about something else', () => {
    expect(targetsFromHistory([], 'TRAINER')).toEqual([]);
    expect(targetsFromHistory(undefined, 'TRAINER')).toEqual([]);
    expect(
      targetsFromHistory(
        [
          user('Was ist ein Primärschlüssel?'),
          model('Ein Primärschlüssel identifiziert eine Zeile eindeutig.'),
        ],
        'TRAINER'
      )
    ).toEqual([]);
  });

  it('two pages: the answer names two menu entries', () => {
    const found = targetsFromHistory(
      [
        user('Wo sehe ich meinen Stand?'),
        model('Im Dashboard oder im Ausbildungsnachweis.'),
      ],
      'TRAINEE'
    );
    expect(found).toHaveLength(2);
    expect(found).toEqual(
      expect.arrayContaining(['dashboard', 'activity_reports'])
    );
  });

  it('the list of trainees is no page for a trainee', () => {
    // a trainee who writes "Azubis" was never offered the card
    expect(
      targetsFromHistory(
        [user('Welche Azubis habe ich?'), model('Dazu habe ich keine Daten.')],
        'TRAINEE'
      )
    ).toEqual([]);
  });

  it('looks at the last three questions only', () => {
    const history = [
      user('Zeig mir meine Berufsschule'),
      model('Ich habe die Seite Berufsschule für dich.'),
      user('Was ist ein Join?'),
      model('Ein Join verbindet Tabellen.'),
      user('Und ein Index?'),
      model('Ein Index beschleunigt Abfragen.'),
      user('Und ein Primärschlüssel?'),
      model('Er identifiziert eine Zeile.'),
    ];
    expect(targetsFromHistory(history, 'TRAINEE')).toEqual([]);
  });

  it('a question without an answer yet is read on its own', () => {
    expect(
      targetsFromHistory([user('Zeig mir meine Berufsschule')], 'TRAINEE')
    ).toEqual(['school']);
  });
});

describe('lastAnswerOfferedPage: what a bare "ja" answers', () => {
  it('is true after an answer that names a menu entry, an opening or a card', () => {
    for (const answer of [
      'Navigiere bitte zum Menüpunkt Auszubildende.',
      'Mit Öffnen gelangst du direkt dorthin.',
      'Ich habe die Seite Berufsschule für dich.',
      'Tippe auf die Karte.',
    ]) {
      expect(lastAnswerOfferedPage([user('x'), model(answer)])).toBe(true);
    }
  });

  it('is false after any other answer and without a history', () => {
    expect(
      lastAnswerOfferedPage([user('x'), model('Ein Join verbindet Tabellen.')])
    ).toBe(false);
    expect(lastAnswerOfferedPage([])).toBe(false);
    expect(lastAnswerOfferedPage(undefined)).toBe(false);
    expect(lastAnswerOfferedPage([user('Ich habe die Seite')])).toBe(false);
  });
});

describe('askWhereToText: the question back', () => {
  it('names two or three pages of the level of the trainee', () => {
    const text = askWhereToText([], 'TRAINEE');
    expect(text).toContain('wohin soll ich dich führen');
    expect(text).toContain('Dashboard, Ausbildungsnachweis oder Lernen');
    expect(text).toContain('öffnet die Plattform die Seite sofort');
    expect(text).not.toContain('Auszubildende');
  });

  it('names the pages of the trainer level', () => {
    expect(askWhereToText([], 'TRAINER')).toContain(
      'Auszubildende, Offene Bewertungen oder Dashboard'
    );
    expect(askWhereToText([], 'ADMIN')).toContain('Auszubildende');
  });

  it('prefers the pages of the history when there are two, limited to the pages of the level', () => {
    expect(askWhereToText(['school', 'quizzes'], 'TRAINEE')).toContain(
      'Berufsschule oder Quizze'
    );
    // a trainee page the trainer level has none for is left out, the examples fill up
    expect(
      askWhereToText(['trainer_feedback', 'dashboard'], 'TRAINER')
    ).toContain('Auszubildende, Offene Bewertungen oder Dashboard');
  });

  it('never carries a path, a link or a dash as separator', () => {
    for (const level of ['TRAINEE', 'TRAINER', 'ADMIN'] as const) {
      const text = askWhereToText(['school', 'calendar'], level);
      expect(text).not.toMatch(/\/|https?:|[–—]/);
    }
  });
});

describe('the pages for the levels: a trainee never gets a page of the trainer area', () => {
  const ids = [
    'trainees',
    'reviews',
    'content_management',
    'organizations',
    'users',
  ] as const;

  it('has no target of the trainer area for the level of the trainee', () => {
    for (const id of ids) {
      expect(staticTargetFor(id, 'TRAINEE')).toBeNull();
    }
  });

  it('every path a trainee can get is a trainee path', () => {
    for (const id of [
      'dashboard',
      'activity_reports',
      'school',
      'calendar',
      'profile',
      'quizzes',
      'courses',
      'trainer_feedback',
      'statistics',
    ] as const) {
      const target = staticTargetFor(id, 'TRAINEE');
      if (target) {
        expect(target.path.startsWith('/trainee/')).toBe(true);
        expect(isAllowedNavigationPath(target.path)).toBe(true);
      }
    }
  });
});

describe('the names of the menu match the platform', () => {
  const de = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'src/locales/de.json'), 'utf-8')
  ) as Record<string, string>;

  it('names the entries of the sidebar as the locale file does', () => {
    expect(MENU_ENTRY_NAMES.TRAINEE).toEqual([
      de['nav.dashboard'],
      de['nav.activityReports'],
      de['nav.school'],
      de['nav.courses'],
      de['nav.trainerFeedback'],
      de['nav.quizzes'],
      de['nav.profile'],
    ]);
    expect(MENU_ENTRY_NAMES.TRAINER).toEqual([
      de['nav.dashboard'],
      de['nav.activityReports'],
      de['nav.school'],
      de['nav.contentManagement'],
      de['nav.quizOverview'],
      de['nav.trainees'],
      de['nav.profile'],
    ]);
  });

  it('every menu name is understood as the page it names', () => {
    const expected: Record<string, string> = {
      Dashboard: 'dashboard',
      Ausbildungsnachweis: 'activity_reports',
      Berufsschule: 'school',
      Lernen: 'courses',
      'Ausbilder-Feedback': 'trainer_feedback',
      Quizze: 'quizzes',
      Profil: 'profile',
      Inhaltsverwaltung: 'content_management',
      'Quiz-Übersicht': 'quizzes',
      Auszubildende: 'trainees',
    };
    for (const [name, target] of Object.entries(expected)) {
      const text =
        name === 'Lernen' ? 'Öffne den Bereich Lernen' : `Öffne ${name}`;
      expect(detectNavigationIntent(text)).toEqual({
        kind: 'static',
        target,
      });
    }
  });
});
