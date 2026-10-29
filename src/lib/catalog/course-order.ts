/**
 * The order of the courses of a training (FIAE and KfBM alike), in one place.
 *
 * The courses are the components of the training plan. Their number is stored
 * in courses.chapter (an integer) and their code in courses.code ("K1", "K6.1",
 * "K10"). The lists used to come out as the database returned them (no ORDER
 * BY), so the sequence was arbitrary: 4, 5, 6, then 1 2 3, and not ending in 25.
 *
 * Order: the number of the component (numeric, a missing number last), then the
 * code and the title in natural order (so K2 comes before K10 and "Komponente
 * 2" before "Komponente 10", never as plain text), at last the id, so the
 * result never depends on the order of the input. This module is pure.
 */

export interface OrderableCourse {
  id?: string | null;
  chapter?: number | string | null;
  code?: string | null;
  title?: string | null;
}

// numeric: "2" < "10", base: case and accents do not decide
const natural = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** The number of the component, or null when there is none to compare. */
function numberOf(chapter: OrderableCourse['chapter']): number | null {
  if (typeof chapter === 'number')
    return Number.isFinite(chapter) ? chapter : null;
  if (typeof chapter === 'string' && chapter.trim() !== '') {
    const n = Number(chapter);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function compareText(a?: string | null, b?: string | null): number {
  const left = (a ?? '').trim();
  const right = (b ?? '').trim();
  // an empty text comes after a filled one
  if (left === '' || right === '') {
    if (left === right) return 0;
    return left === '' ? 1 : -1;
  }
  return natural.compare(left, right);
}

export function compareCourses(a: OrderableCourse, b: OrderableCourse): number {
  const na = numberOf(a.chapter);
  const nb = numberOf(b.chapter);
  if (na !== nb) {
    if (na === null) return 1;
    if (nb === null) return -1;
    return na - nb;
  }
  return (
    compareText(a.code, b.code) ||
    compareText(a.title, b.title) ||
    String(a.id ?? '').localeCompare(String(b.id ?? ''))
  );
}

/** A copy of the list in the order of the training plan. */
export function sortCourses<T extends OrderableCourse>(
  list: ReadonlyArray<T>
): T[] {
  return [...list].sort(compareCourses);
}
