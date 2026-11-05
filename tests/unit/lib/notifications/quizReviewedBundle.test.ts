import de from '@/locales/de.json';
import en from '@/locales/en.json';
import { formatNotification } from '@/lib/notifications/format';
import { quizzesReviewedMessage } from '@/lib/notifications/quiz-reviewed';

// WMCNL-3001: a trainer who marks many quizzes of one trainee as reviewed in
// one step sends one notification. The bell reads it like the one of a single
// quiz: German title, and the sentence in the language of the reader.

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

const row = (message: string) => ({
  type: 'QUIZ_REVIEWED',
  title: 'Quiz bewertet',
  message,
  createdAt: '2026-11-03T08:00:00Z',
});

describe('bundled notification "Quiz bewertet"', () => {
  const stored = quizzesReviewedMessage(3, ['Netze', 'Datenbanken', 'Recht']);

  it('is stored in German with the titles', () => {
    expect(stored).toBe(
      'Deine 3 Quizze wurden bewertet: „Netze“, „Datenbanken“, „Recht“'
    );
  });

  it('reads the same in the German bell', () => {
    expect(formatNotification(row(stored), tDe)).toEqual({
      title: 'Quiz bewertet',
      message: stored,
    });
  });

  it('is translated in the English bell, the titles stay as they are', () => {
    expect(formatNotification(row(stored), tEn)).toEqual({
      title: 'Quiz graded',
      message:
        'Your 3 quizzes have been graded: „Netze“, „Datenbanken“, „Recht“',
    });
  });

  it('is translated without titles, too', () => {
    const plain = quizzesReviewedMessage(4, []);
    expect(formatNotification(row(plain), tEn).message).toBe(
      'Your 4 quizzes have been graded.'
    );
    expect(formatNotification(row(plain), tDe).message).toBe(plain);
  });

  it('keeps the text of exactly one quiz as it was', () => {
    expect(
      formatNotification(row('Dein Quiz wurde bewertet.'), tEn).message
    ).toBe('Your quiz has been graded.');
  });
});
