import de from '@/locales/de.json';
import en from '@/locales/en.json';
import {
  MAX_LINK_URL_LENGTH,
  firstInvalidLinkIndex,
  isValidLinkUrl,
} from '@/lib/submission-input';
import { sameText } from '@/lib/display-text';
import { achievementText, deadlineLabel } from '@/lib/dashboard-text';
import { notificationText } from '@/lib/notification-text';

// Fix round azubi_lernen2 (Jira WMCNL-2928, 2934, 2970, 2971).

const dict =
  (lang: Record<string, string>) =>
  (key: string, data?: Record<string, string | number>) => {
    let text = lang[key] || key;
    Object.entries(data ?? {}).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v));
    });
    return text;
  };
const tDe = dict(de as Record<string, string>);
const tEn = dict(en as Record<string, string>);

describe('links of a hand-in (WMCNL-2928)', () => {
  it.each([
    'https://github.com/a/b',
    'http://localhost:3000/x?y=1#z',
    ' https://1drv.ms/abc ',
    'https://a',
  ])('takes %s', url => {
    expect(isValidLinkUrl(url)).toBe(true);
  });

  it.each([
    'kein-link',
    'www.example.org',
    'ftp://example.org',
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://',
    'https://exa mple.org',
    '',
    '   ',
    `https://a.org/${'x'.repeat(MAX_LINK_URL_LENGTH)}`,
  ])('refuses %j', url => {
    expect(isValidLinkUrl(url)).toBe(false);
  });

  it('refuses what is no text', () => {
    expect(isValidLinkUrl(undefined)).toBe(false);
    expect(isValidLinkUrl(null)).toBe(false);
    expect(isValidLinkUrl(5)).toBe(false);
  });

  it('finds the first row with a bad address and skips empty rows', () => {
    expect(firstInvalidLinkIndex(undefined)).toBe(-1);
    expect(firstInvalidLinkIndex([{ url: '' }, { url: ' ' }])).toBe(-1);
    expect(
      firstInvalidLinkIndex([
        { url: 'https://a.org' },
        { url: '' },
        { url: 'kein-link' },
        { url: 'x' },
      ])
    ).toBe(2);
    expect(firstInvalidLinkIndex([null, 'https://a.org'])).toBe(-1);
  });
});

describe('description that repeats the title (WMCNL-2934)', () => {
  it('knows the same text despite white space, capitals and a full stop', () => {
    expect(sameText('Titel des  Use Case', ' titel des use case. ')).toBe(true);
  });
  it('knows different texts and empty texts', () => {
    expect(sameText('Titel', 'Titel und mehr')).toBe(false);
    expect(sameText('', '')).toBe(false);
    expect(sameText(null, undefined)).toBe(false);
  });
});

describe('dashboard sentences in the language of the trainee (WMCNL-2970)', () => {
  const quiz = {
    text: '40% im Quiz "X"',
    code: 'quizPassed',
    params: { score: 40, title: 'X' },
  };
  it('writes an achievement in German and in English', () => {
    expect(achievementText(tDe, quiz)).toBe('40% im Quiz "X"');
    expect(achievementText(tEn, quiz)).toBe('40% in the quiz "X"');
    expect(
      achievementText(tEn, {
        text: 'Enabler "Y" abgeschlossen',
        code: 'enablerDone',
        params: { title: 'Y' },
      })
    ).toBe('Topic area "Y" completed');
    expect(
      achievementText(tEn, { text: '', code: 'streak', params: { days: 4 } })
    ).toBe('Learned 4 days in a row');
  });
  it('shows the German sentence of a row without a code', () => {
    expect(achievementText(tEn, { text: 'Alter Satz' })).toBe('Alter Satz');
    expect(deadlineLabel(tEn, { label: 'Alte Phase' })).toBe('Alte Phase');
  });
  it('writes a phase deadline in German and in English', () => {
    const row = {
      label: 'Phase 1 (1. bis 18. Ausbildungsmonat)',
      labelCode: 'phase',
      labelParams: { stage: 1, startMonth: 1, endMonth: 18 },
    };
    expect(deadlineLabel(tDe, row)).toBe(row.label);
    expect(deadlineLabel(tEn, row)).toBe('Phase 1 (training months 1 to 18)');
    expect(
      deadlineLabel(tEn, {
        label: '',
        labelCode: 'phaseIntegrative',
        labelParams: { months: 36 },
      })
    ).toBe('Integrative skills (training months 1 to 36)');
  });
});

describe('notifications in the language of the reader (WMCNL-2970)', () => {
  const n = (type: string, title: string, message: string | null) => ({
    type,
    title,
    message,
  });

  it('keeps the German sentence in German', () => {
    expect(
      notificationText(
        tDe,
        n(
          'COURSE_UPDATED',
          'Fragenkomplex aktualisiert',
          'Der Fragenkomplex "Netze" wurde aktualisiert.'
        )
      )
    ).toEqual({
      title: 'Fragenkomplex aktualisiert',
      message: 'Der Fragenkomplex "Netze" wurde aktualisiert.',
    });
  });

  it.each([
    [
      'COURSE_UPDATED',
      'Der Fragenkomplex "Netze" wurde aktualisiert.',
      'Question set updated',
      'The question set "Netze" has been updated.',
    ],
    [
      'GLOBAL_QUIZ_ASSIGNED',
      'Dir wurde ein neues Quiz zugewiesen: "Quiz 1"',
      'New quiz assigned',
      'A quiz has been assigned to you: "Quiz 1"',
    ],
    [
      'QUIZ_REVIEWED',
      'Dein Quiz wurde bewertet. Trainer-Feedback ist verfügbar.',
      'Quiz graded',
      'Your quiz has been graded. Trainer feedback is available.',
    ],
    [
      'EXAM_GRADED',
      'Deine Prüfung "Mathe" wurde bewertet: 8/10 Punkte (80.0%).',
      'Exam graded',
      'Your exam "Mathe" has been graded: 8/10 points (80.0%).',
    ],
    [
      'BLOCK_SCHEDULED',
      'Ein neuer Block "Schule" wurde für 01.12.2026 – 12.12.2026 geplant.',
      'New block scheduled',
      'A new block "Schule" has been scheduled from 01.12.2026 to 12.12.2026.',
    ],
    [
      'ENABLER_QUIZ_CREATED',
      'Ein neues Mittel-Quiz wurde für "Netze" erstellt.',
      'New quiz available',
      'A new quiz (medium) has been created for "Netze".',
    ],
    [
      'USE_CASE_FEEDBACK',
      'Status: APPROVED',
      'Feedback on the use case',
      'Status: Approved',
    ],
  ])('translates %s', (type, message, title, expected) => {
    expect(notificationText(tEn, n(type, 'x', message))).toEqual({
      title,
      message: expected,
    });
  });

  it('shows a sentence that no pattern knows as it is stored', () => {
    expect(
      notificationText(tEn, n('COURSE_UPDATED', 'T', 'Ganz anderer Satz'))
    ).toEqual({ title: 'Question set updated', message: 'Ganz anderer Satz' });
  });

  it('shows a type that is not known as it is stored', () => {
    expect(
      notificationText(tEn, n('SOMETHING_NEW', 'Neuer Titel', 'Neuer Text'))
    ).toEqual({ title: 'Neuer Titel', message: 'Neuer Text' });
    expect(notificationText(tEn, n('QUIZ_DELETED', 'T', null)).message).toBe(
      null
    );
  });
});

describe('texts of the trainee area address the trainee with du (WMCNL-2971)', () => {
  const SIE = /\b(Sie|Ihnen|Ihr|Ihre|Ihrem|Ihren|Ihrer|Ihres)\b/;

  // Keys that the trainee sees on his pages and in his error messages
  const traineeKeys = [
    'profile.birthDateRequiredText',
    'profile.notLoggedIn',
    'lernfelder.tryDifferentSearch',
    'lernfelder.noneAssigned',
    'reports.createFirstPrompt',
    'reports.deleteConfirm',
    'reports.error.noEntries',
    'reports.error.missingHours',
    'reports.error.missingNotes',
    'reports.error.invalidPeriod',
    'reports.error.skillRatingsMissing',
    'reports.modal.instructions',
    'reports.modal.duplicate',
    'reports.modal.overbooking',
    'reports.skillSelfRatingInfo',
    'modules.description',
    'quiz.description',
    'catalog.tiles.subtitleTrainee',
    'catalog.tiles.userErrorTrainee',
    'catalog.tiles.traineeLocked',
    'accessNotice.wrongArea.trainer.text',
    'enablerPage.keyAfterPass',
    'securePdf.loadFailed',
    'useCase.linkInvalid',
    'enablerPage.answerRequired',
    'enablerPage.answerRequiredText',
  ];

  it.each(traineeKeys)('%s has no Sie', key => {
    const text = (de as Record<string, string>)[key];
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(SIE);
  });

  it('keeps the formal address for the roles that are no trainees', () => {
    expect((de as Record<string, string>)['catalog.tiles.subtitle']).toMatch(
      SIE
    );
  });
});

describe('the new keys exist in both languages', () => {
  const block = (lang: Record<string, string>) => {
    const keys = Object.keys(lang);
    return keys.slice(keys.indexOf('_comment.azubi_lernen2') + 1);
  };
  it('has the same keys in de and en', () => {
    const deKeys = block(de as Record<string, string>);
    expect(deKeys.length).toBeGreaterThan(20);
    expect(block(en as Record<string, string>)).toEqual(deKeys);
  });
  it('has a title for every notification type of the module', () => {
    const titled = Object.keys(de).filter(k =>
      /^notifications\.type\..+\.title$/.test(k)
    );
    // 18 of the module plus the 4 submission types of the trainees, which
    // `formatNotification` builds from the facts of the row
    expect(titled.length).toBe(22);
  });
});
