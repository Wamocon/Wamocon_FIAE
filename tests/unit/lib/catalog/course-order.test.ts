import { describe, it, expect } from '@jest/globals';
import { compareCourses, sortCourses } from '@/lib/catalog/course-order';

// KFB-1175: the courses started at 4, 1 2 3 stood in the middle and the last
// one was not number 25. The list had no order at all (the database returned
// the rows as they came). Order: by the number of the component (numeric, not
// as text), then by the code ("K6.1" before "K6.2", "K2" before "K10"), then
// by the title (natural), at last by the id.

const course = (
  id: string,
  chapter: number | null,
  code: string | null = null,
  title = `Kurs ${id}`
) => ({ id, chapter, code, title });

const ids = (list: Array<{ id: string }>) => list.map(c => c.id);

describe('sortCourses', () => {
  it('sorts numerically by the number of the component, 25 last', () => {
    const shuffled = [4, 5, 10, 1, 2, 3, 25, 9, 11, 24, 6, 7, 8].map(n =>
      course(`c${n}`, n)
    );
    expect(ids(sortCourses(shuffled))).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 24, 25].map(n => `c${n}`)
    );
  });

  it('does not sort as text (10 after 9, not after 1)', () => {
    const list = [
      course('a', 10),
      course('b', 9),
      course('c', 1),
      course('d', 2),
    ];
    expect(ids(sortCourses(list))).toEqual(['c', 'd', 'b', 'a']);
  });

  it('a number as text counts as a number', () => {
    const list = [
      { id: 'a', chapter: '10' as any, code: null, title: 'A' },
      { id: 'b', chapter: '9' as any, code: null, title: 'B' },
    ];
    expect(ids(sortCourses(list))).toEqual(['b', 'a']);
  });

  it('puts courses without a number behind the numbered ones', () => {
    const list = [course('x', null), course('b', 2), course('a', 1)];
    expect(ids(sortCourses(list))).toEqual(['a', 'b', 'x']);
  });

  it('orders the same number by the code in natural order', () => {
    const list = [
      course('k10', 3, 'K10'),
      course('k6_2', 3, 'K6.2'),
      course('k2', 3, 'K2'),
      course('k6_1', 3, 'K6.1'),
    ];
    expect(ids(sortCourses(list))).toEqual(['k2', 'k6_1', 'k6_2', 'k10']);
  });

  it('orders courses without any number by code, then by title in natural order', () => {
    const list = [
      course('t10', null, null, 'Komponente 10'),
      course('t2', null, null, 'Komponente 2'),
      course('t1', null, null, 'Komponente 1'),
    ];
    expect(ids(sortCourses(list))).toEqual(['t1', 't2', 't10']);
  });

  it('is stable and does not change its input', () => {
    const input = [course('b', 2), course('a', 1)];
    const copy = [...input];
    const out = sortCourses(input);
    expect(input).toEqual(copy);
    expect(out).not.toBe(input);
    expect(ids(sortCourses(out))).toEqual(ids(out));
  });

  it('the same data in another input order gives the same list', () => {
    const base = [
      course('1', 1),
      course('2', 2),
      course('3', 3, 'K3'),
      course('4', 3, 'K3a'),
      course('5', null),
    ];
    const reversed = [...base].reverse();
    expect(ids(sortCourses(reversed))).toEqual(ids(sortCourses(base)));
  });

  it('an equal course is ordered by the id at last', () => {
    expect(
      compareCourses(course('a', 1, 'K1', 'T'), course('b', 1, 'K1', 'T'))
    ).toBeLessThan(0);
    expect(
      compareCourses(course('a', 1, 'K1', 'T'), course('a', 1, 'K1', 'T'))
    ).toBe(0);
  });
});
