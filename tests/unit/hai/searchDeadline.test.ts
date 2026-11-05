/**
 * @jest-environment node
 */

// The time limit of the knowledge search for a short question about the own data
// (src/lib/hai/searchDeadline.ts): which questions it is for, and how the limit
// behaves.

import {
  DATA_QUESTION_SEARCH_DEADLINE_MS,
  isPersonalDataQuestion,
  searchDeadlineMs,
  withDeadline,
} from '@/lib/hai/searchDeadline';

describe('isPersonalDataQuestion', () => {
  it.each([
    'Wie ist mein Fortschritt?',
    'Wie ist mein Fortschritt in SQL?',
    'Wann habe ich Berufsschule?',
    'Wann ist meine nächste Prüfung?',
    'Welche Note habe ich in Mathe?',
    'Habe ich die Prüfung bestanden?',
    'Welche Abgaben habe ich noch offen?',
    'Habe ich neue Benachrichtigungen?',
    'Wie ist der Stand meiner Nachweise?',
    'Wie stehen meine Azubis?',
    'Welche Termine habe ich diese Woche?',
  ])('"%s" is a question about the own data', message => {
    expect(isPersonalDataQuestion(message)).toBe(true);
    expect(searchDeadlineMs(message)).toBe(DATA_QUESTION_SEARCH_DEADLINE_MS);
  });

  it.each([
    'Was ist Normalisierung?',
    'Was ist ein Block in Python?',
    'Erkläre die Zwischenprüfung Teil 1',
    'Was ist der Status Code 404?',
    'Welche Note ist in Deutschland die beste?',
    'Wie funktioniert ein Fortschrittsbalken in CSS?',
    '',
    '   ',
  ])('"%s" keeps the full search', message => {
    expect(searchDeadlineMs(message)).toBeNull();
  });

  it('a long message is a knowledge question even with first person and a data word', () => {
    const long = `Wie ist mein Fortschritt? ${'Ich habe viel Text dazu geschrieben. '.repeat(10)}`;
    expect(long.length).toBeGreaterThan(160);
    expect(isPersonalDataQuestion(long)).toBe(false);
  });

  it('the limit is 4 seconds', () => {
    expect(DATA_QUESTION_SEARCH_DEADLINE_MS).toBe(4_000);
  });
});

describe('withDeadline', () => {
  afterEach(() => jest.useRealTimers());

  it('without a limit it just waits', async () => {
    await expect(withDeadline(Promise.resolve(7), null)).resolves.toEqual({
      timedOut: false,
      value: 7,
    });
  });

  it('returns the value of work that is quick enough, and leaves no timer behind', async () => {
    jest.useFakeTimers();
    const outcome = await withDeadline(Promise.resolve('x'), 4000);
    expect(outcome).toEqual({ timedOut: false, value: 'x' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('gives up after the limit, the late result is dropped', async () => {
    jest.useFakeTimers();
    let resolve!: (value: string) => void;
    const work = new Promise<string>(r => {
      resolve = r;
    });
    const pending = withDeadline(work, 4000);
    await jest.advanceTimersByTimeAsync(4000);
    await expect(pending).resolves.toEqual({ timedOut: true });
    resolve('late');
    await jest.advanceTimersByTimeAsync(1);
  });

  it('a late failure of the abandoned work is not an unhandled rejection', async () => {
    // setImmediate stays real: the test needs a real turn of the event loop
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    let reject!: (error: Error) => void;
    const work = new Promise<string>((_resolve, r) => {
      reject = r;
    });
    const pending = withDeadline(work, 100);
    await jest.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toEqual({ timedOut: true });
    const unhandled = jest.fn();
    process.once('unhandledRejection', unhandled);
    reject(new Error('late'));
    await jest.advanceTimersByTimeAsync(1);
    await new Promise(resolve => setImmediate(resolve));
    process.removeListener('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('a failure before the limit is thrown', async () => {
    await expect(
      withDeadline(Promise.reject(new Error('boom')), 4000)
    ).rejects.toThrow('boom');
  });
});
