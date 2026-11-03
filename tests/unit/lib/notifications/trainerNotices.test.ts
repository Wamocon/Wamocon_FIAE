import de from '@/locales/de.json';
import en from '@/locales/en.json';
import {
  formatNotification,
  sortNewestFirst,
} from '@/lib/notifications/format';
import {
  SUBMISSION_NOTICE_TYPES,
  submissionNoticeText,
} from '@/lib/notifications/submissionNotice';

// WMCNL-3029 (test of 02.11.2026): the bell of a trainer showed "Trainee hat
// ein LOW-Quiz abgegeben" and "Ein Trainee hat ein Enabler-Szenario
// eingereicht": no name, English words, and the entries were not in order of
// their date. The text is built from the type and the facts of the row, in the
// language of the reader, so rows written before the fix read like new ones.

const translator =
  (strings: Record<string, string>) =>
  (key: string, data?: Record<string, string | number>) => {
    let text = strings[key] || key;
    Object.entries(data ?? {}).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v));
    });
    return text;
  };
const tDe = translator(de as Record<string, string>);
const tEn = translator(en as Record<string, string>);

const row = (over: Record<string, unknown>) => ({
  type: 'LESSON_QUIZ_SUBMITTED',
  title: 'Themenkreis-Quiz eingereicht',
  message: 'Trainee hat ein LOW-Quiz abgegeben: Netzwerke',
  actorName: null as string | null,
  context: null as Record<string, unknown> | null,
  createdAt: '2026-11-02T08:00:00.000Z',
  ...over,
});

describe('formatNotification', () => {
  it('names the trainee and speaks German for a lesson quiz of an older row', () => {
    const text = formatNotification(
      row({ actorName: 'Leon Moretz', context: { difficulty: 'LOW' } }),
      tDe
    );
    expect(text.title).toBe('Themenkreis-Quiz eingereicht');
    expect(text.message).toBe(
      'Leon Moretz hat ein Quiz der Stufe Niedrig abgegeben: Netzwerke'
    );
    expect(text.message).not.toMatch(/Trainee|LOW|Enabler/);
  });

  it('speaks English for a reader who chose English', () => {
    const text = formatNotification(
      row({ actorName: 'Leon Moretz', context: { difficulty: 'HIGH' } }),
      tEn
    );
    expect(text.title).toBe('Topic quiz submitted');
    expect(text.message).toBe(
      'Leon Moretz submitted a quiz of level High: Netzwerke'
    );
  });

  it('takes name and subject from the context of a new row', () => {
    const text = formatNotification(
      row({
        type: 'ENABLER_SUBMITTED',
        title: 'Szenario eingereicht',
        message: 'x',
        context: { traineeName: 'Mia Berg', subjectTitle: 'Titel: Teil 2' },
      }),
      tDe
    );
    expect(text.message).toBe(
      'Mia Berg hat ein Szenario eingereicht: Titel: Teil 2'
    );
  });

  it('keeps a title with a colon whole when it is read from an older text', () => {
    const text = formatNotification(
      row({
        type: 'USE_CASE_SUBMITTED',
        message: 'Ein Trainee hat einen Use Case eingereicht: Plan: Phase 1',
        actorName: 'Mia Berg',
      }),
      tDe
    );
    expect(text.message).toBe(
      'Mia Berg hat einen Use Case eingereicht: Plan: Phase 1'
    );
  });

  it('falls back to "Ein Azubi" when the name is unknown, never to "Trainee"', () => {
    const text = formatNotification(
      row({
        type: 'ENABLER_QUIZ_SUBMITTED',
        message: 'Ein Trainee hat ein Mini-Quiz abgegeben: Git',
      }),
      tDe
    );
    expect(text.message).toBe('Ein Azubi hat ein Mini-Quiz abgegeben: Git');
  });

  it('leaves the other types as they are stored', () => {
    const text = formatNotification(
      row({ type: 'catalog_request', title: 'Neue Anfrage', message: 'Max' }),
      tDe
    );
    expect(text).toEqual({ title: 'Neue Anfrage', message: 'Max' });
  });

  it.each(SUBMISSION_NOTICE_TYPES)(
    'has a German and an English text for %s',
    type => {
      for (const strings of [de, en] as Array<Record<string, string>>) {
        expect(strings[`notifications.type.${type}.title`]).toBeTruthy();
        const message = strings[`notifications.type.${type}.message`];
        expect(message).toContain('{name}');
        expect(message).toContain('{subject}');
      }
    }
  );
});

describe('submissionNoticeText (the German text stored with the row)', () => {
  it('names the trainee and uses German words', () => {
    const all = SUBMISSION_NOTICE_TYPES.map(type =>
      submissionNoticeText(type, {
        traineeName: 'Leon Moretz',
        subject: 'Netzwerke',
        difficulty: 'MEDIUM',
      })
    );
    for (const { title, message } of all) {
      expect(message).toContain('Leon Moretz');
      expect(`${title} ${message}`).not.toMatch(
        /Trainee|LOW|MEDIUM|HIGH|Enabler/
      );
    }
    expect(
      submissionNoticeText('LESSON_QUIZ_SUBMITTED', {
        traineeName: 'Leon Moretz',
        subject: 'Netzwerke',
        difficulty: 'MEDIUM',
      }).message
    ).toContain('Stufe Mittel');
  });

  it('writes "Ein Azubi" without a name', () => {
    expect(
      submissionNoticeText('USE_CASE_SUBMITTED', {
        traineeName: '  ',
        subject: 'UC',
      }).message
    ).toBe('Ein Azubi hat einen Use Case eingereicht: UC');
  });
});

describe('sortNewestFirst', () => {
  it('orders by date, whatever the read state or the incoming order', () => {
    const items = [
      { id: 'a', createdAt: '2026-11-02T09:00:00.000Z' },
      { id: 'b', createdAt: '2026-10-30T09:00:00.000Z' },
      { id: 'c', createdAt: '2026-11-02T10:00:00.000Z' },
    ];
    expect(sortNewestFirst(items).map(i => i.id)).toEqual(['c', 'a', 'b']);
    expect(items.map(i => i.id)).toEqual(['a', 'b', 'c']);
  });
});
