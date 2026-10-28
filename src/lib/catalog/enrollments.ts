/**
 * Several enrollments of one trainee: the order in which they count and the
 * start date and duration each one carries. Pure functions without database or
 * server imports, so the catalog scope, the admin area, the phase plan and the
 * content assignment all decide the same way.
 *
 * A trainee can be enrolled in several trainings (occupations), also at the same
 * time, one enrollment per catalog.
 *
 *  - Order: the training the trainee was enrolled in first comes first (created
 *    at, then start date, then the catalog id as a stable last resort). The first
 *    one is the default occupation of the trainee when nothing was chosen, and
 *    the "primary" enrollment.
 *  - Terms: profiles.start_of_training_date and ausbildung_duration_years are the
 *    live values of the first training (the profile is edited, the enrollment row
 *    is a copy made at enrollment time, and a trainee created by an admin gets a
 *    row without a start date that the profile fills in later). So the primary
 *    enrollment follows the profile, as it always did. Every further enrollment
 *    has its own start date and duration (copied from the profile when it was
 *    added, or given by the admin), the profile does not describe it.
 */

/** What the order of enrollments needs. */
export type EnrollmentOrderInput = {
  trainingCatalogId: string;
  createdAt?: Date | string | null;
  startDate?: string | null;
};

function timeOf(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

/** Earlier enrollment first. */
export function compareEnrollments(
  a: EnrollmentOrderInput,
  b: EnrollmentOrderInput
): number {
  const byCreated = timeOf(a.createdAt) - timeOf(b.createdAt);
  if (byCreated !== 0) return byCreated;
  // A missing start date sorts last
  const byStart = String(a.startDate ?? '9999-12-31').localeCompare(
    String(b.startDate ?? '9999-12-31')
  );
  if (byStart !== 0) return byStart;
  return String(a.trainingCatalogId).localeCompare(String(b.trainingCatalogId));
}

/** The enrollments, the one the trainee started with first. */
export function sortEnrollments<T extends EnrollmentOrderInput>(
  rows: readonly T[]
): T[] {
  return [...rows].sort(compareEnrollments);
}

/** The first enrollment of a trainee (the default occupation), if any. */
export function firstEnrollment<T extends EnrollmentOrderInput>(
  rows: readonly T[]
): T | undefined {
  return sortEnrollments(rows)[0];
}

/** Start date and duration an enrollment counts with. */
export type EnrollmentTerms = {
  startDate: string | Date | null;
  durationYears: number | null;
};

/**
 * The start date and duration of one enrollment. The primary enrollment follows
 * the profile (a missing profile value falls back to the row), every other
 * enrollment follows its own row (a missing start date falls back to the
 * profile, the best guess for a training that starts together with the first).
 */
export function effectiveEnrollmentTerms(input: {
  enrollment: {
    startDate?: string | Date | null;
    durationYears?: number | null;
  };
  isPrimary: boolean;
  profile: {
    startDate?: string | Date | null;
    durationYears?: number | null;
  };
}): EnrollmentTerms {
  const { enrollment, isPrimary, profile } = input;
  if (isPrimary) {
    return {
      startDate: profile.startDate ?? enrollment.startDate ?? null,
      durationYears: profile.durationYears ?? enrollment.durationYears ?? null,
    };
  }
  return {
    startDate: enrollment.startDate ?? profile.startDate ?? null,
    durationYears: enrollment.durationYears ?? profile.durationYears ?? null,
  };
}

/** A date as the text of the date column (yyyy-mm-dd), or null if it is none. */
export function toDateOnly(
  value: Date | string | null | undefined
): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a text is a real calendar date in the form yyyy-mm-dd. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
