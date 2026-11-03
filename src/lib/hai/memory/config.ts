/**
 * HAI memory: the switch and the fixed numbers (docs/hai-gedaechtnis.md).
 *
 * The whole feature sits behind the environment switch HAI_MEMORY (default off,
 * like the other HAI switches such as HAI_TRAINER_SOLUTIONS). Without it nothing
 * of the memory is read, written or offered, and the HAI behaves byte for byte as
 * before. Pure module (no database), shared by the pipeline, the routes and the
 * tests.
 *
 * @module lib/hai/memory/config
 */

/** Name of the environment switch. */
export const MEMORY_ENV = 'HAI_MEMORY';

/** True only for the value "on" (any case), everything else is off. */
export function isMemoryEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    String(env[MEMORY_ENV] ?? '')
      .trim()
      .toLowerCase() === 'on'
  );
}

/** Longest text of an entry of one user (the database checks the same). */
export const USER_MEMORY_MAX_CHARS = 300;

/** Longest text of an entry of the shared memory (the database checks the same). */
export const GLOBAL_MEMORY_MAX_CHARS = 400;

/** How many own entries (active and proposed) one user may hold per occupation. */
export const USER_MEMORY_MAX_ENTRIES = 30;

/** The prompt carries at most this many entries of the user ... */
export const PROMPT_MAX_USER_ENTRIES = 8;
/** ... and this many entries of the shared memory ... */
export const PROMPT_MAX_GLOBAL_ENTRIES = 4;
/** ... and at most this many characters of entry text in total (both lists). */
export const PROMPT_MAX_CHARS = 1200;

/**
 * Minimum number of DIFFERENT users a proposal for the shared memory must rest
 * on (k anonymity). Below it no proposal exists: a count of one to four could
 * point at a person. The database query applies it as HAVING, so a smaller
 * count never leaves the database.
 */
export const GLOBAL_MIN_SUPPORT_K = 5;

/** A weakness needs at least this many graded quiz attempts in the topic ... */
export const WEAKNESS_MIN_ATTEMPTS = 2;
/** ... and an average score (percent) below this value. */
export const WEAKNESS_BELOW_SCORE = 60;
/** At most this many weakness proposals come out of one calculation. */
export const WEAKNESS_MAX_TOPICS = 2;

/**
 * After a derived proposal (weakness, learning state) the HAI does not ask for a
 * derived one again for this many days, so the question stays a rare one.
 */
export const DERIVE_COOLDOWN_DAYS = 7;

/** A message longer than this is no statement about a preference. */
export const DETECT_MAX_MESSAGE_CHARS = 300;
