import { describe, it, expect } from '@jest/globals';
import { attemptSeed, orderOptionsForAttempt } from '@/lib/quiz/option-order';

const opts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `o-${i + 1}`,
    optionText: `Text of choice ${i + 1}`,
    orderIndex: i + 1,
  }));

const ids = (list: Array<{ id: string }>) => list.map(o => o.id);

describe('orderOptionsForAttempt', () => {
  it('keeps every option exactly once', () => {
    const out = orderOptionsForAttempt(opts(4), 'seed-a', 'q-1');
    expect(ids(out).sort()).toEqual(['o-1', 'o-2', 'o-3', 'o-4']);
  });

  it('is stable for the same seed, whatever the input order', () => {
    const a = orderOptionsForAttempt(opts(5), 'seed-a', 'q-1');
    const b = orderOptionsForAttempt([...opts(5)].reverse(), 'seed-a', 'q-1');
    expect(ids(a)).toEqual(ids(b));
  });

  it('does not change its input', () => {
    const input = opts(4);
    const before = ids(input);
    orderOptionsForAttempt(input, 'seed-a', 'q-1');
    expect(ids(input)).toEqual(before);
  });

  it('moves the right option over many attempts instead of fixing it', () => {
    const places = new Set<number>();
    for (let attempt = 1; attempt <= 40; attempt++) {
      const out = orderOptionsForAttempt(
        opts(4),
        attemptSeed('t1', 'quiz-1', attempt),
        'q-1'
      );
      places.add(ids(out).indexOf('o-1'));
    }
    expect(places.size).toBeGreaterThan(1);
  });

  it('gives another order to another attempt', () => {
    const orders = new Set<string>();
    for (let attempt = 1; attempt <= 10; attempt++) {
      orders.add(
        ids(
          orderOptionsForAttempt(
            opts(6),
            attemptSeed('t1', 'quiz-1', attempt),
            'q-1'
          )
        ).join()
      );
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('gives another order to another trainee and another question', () => {
    const byTrainee = new Set<string>();
    const byQuestion = new Set<string>();
    for (let i = 1; i <= 10; i++) {
      byTrainee.add(
        ids(
          orderOptionsForAttempt(
            opts(6),
            attemptSeed(`t${i}`, 'quiz-1', 1),
            'q-1'
          )
        ).join()
      );
      byQuestion.add(
        ids(
          orderOptionsForAttempt(
            opts(6),
            attemptSeed('t1', 'quiz-1', 1),
            `q-${i}`
          )
        ).join()
      );
    }
    expect(byTrainee.size).toBeGreaterThan(1);
    expect(byQuestion.size).toBeGreaterThan(1);
  });

  it('sorts by order_index first, so old rows without an index come last', () => {
    const rows = [
      { id: 'late', optionText: 'L', orderIndex: null },
      { id: 'b', optionText: 'B', orderIndex: 2 },
      { id: 'a', optionText: 'A', orderIndex: 1 },
    ];
    const first = orderOptionsForAttempt(rows, 'seed-x', 'q');
    const second = orderOptionsForAttempt([...rows].reverse(), 'seed-x', 'q');
    expect(ids(first)).toEqual(ids(second));
  });

  it('leaves an empty list and a single option alone', () => {
    expect(orderOptionsForAttempt([], 'seed', 'q')).toEqual([]);
    expect(ids(orderOptionsForAttempt(opts(1), 'seed', 'q'))).toEqual(['o-1']);
  });

  it('keeps the order when an option refers to the others by position', () => {
    const refs = [
      { id: 'a', optionText: 'Erste', orderIndex: 1 },
      { id: 'b', optionText: 'Zweite', orderIndex: 2 },
      { id: 'c', optionText: 'Alle oben genannten', orderIndex: 3 },
    ];
    for (let attempt = 1; attempt <= 20; attempt++) {
      expect(
        ids(orderOptionsForAttempt(refs, attemptSeed('t', 'q', attempt), 'q-1'))
      ).toEqual(['a', 'b', 'c']);
    }
    for (const text of [
      'Keine der genannten Antworten',
      'Alle Antworten sind richtig',
      'A und B',
      'All of the above',
      'None of the above',
    ]) {
      const rows = [
        { id: 'x', optionText: 'X', orderIndex: 1 },
        { id: 'y', optionText: 'Y', orderIndex: 2 },
        { id: 'z', optionText: text, orderIndex: 3 },
      ];
      expect(ids(orderOptionsForAttempt(rows, 'seed', 'q'))).toEqual([
        'x',
        'y',
        'z',
      ]);
    }
  });

  it('does not take an ordinary answer for a reference', () => {
    const rows = [
      {
        id: 'x',
        optionText: 'Alle Mitarbeiter erhalten Zugang',
        orderIndex: 1,
      },
      { id: 'y', optionText: 'Keine Mitarbeiter', orderIndex: 2 },
    ];
    const orders = new Set<string>();
    for (let attempt = 1; attempt <= 20; attempt++) {
      orders.add(
        ids(
          orderOptionsForAttempt(rows, attemptSeed('t', 'q', attempt), 'q-1')
        ).join()
      );
    }
    expect(orders.size).toBe(2);
  });
});

describe('attemptSeed', () => {
  it('differs by trainee, quiz and attempt', () => {
    const base = attemptSeed('t1', 'q1', 1);
    expect(attemptSeed('t2', 'q1', 1)).not.toEqual(base);
    expect(attemptSeed('t1', 'q2', 1)).not.toEqual(base);
    expect(attemptSeed('t1', 'q1', 2)).not.toEqual(base);
    expect(attemptSeed('t1', 'q1', 1)).toEqual(base);
  });
});
