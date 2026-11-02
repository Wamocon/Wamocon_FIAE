/**
 * The trainee chosen in the calendar of the trainer. A switch of the occupation
 * tab loads the page content again (the list of the trainees is another one),
 * and the choice used to jump to the first trainee of the new list. Now the
 * choice is kept for the browser tab (sessionStorage, a convenience only) and
 * kept when that trainee is in the new list too, otherwise the first trainee is
 * taken on purpose.
 */

const KEY = 'wmc_trainer_calendar_trainee';

/** The stored trainee when it is in the list, otherwise the first one. */
export function pickTraineeId(
  ids: readonly string[],
  stored: string | null | undefined
): string {
  if (stored && ids.includes(stored)) return stored;
  return ids[0] ?? '';
}

export function readStoredTraineeId(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function storeTraineeId(id: string): void {
  try {
    if (id) window.sessionStorage.setItem(KEY, id);
  } catch {
    // storage is a convenience, the calendar works without it
  }
}
