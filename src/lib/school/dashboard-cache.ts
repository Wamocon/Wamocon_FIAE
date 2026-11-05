import { apiCache } from '@/lib/api-cache';

/**
 * Drop the cached dashboards of the trainees after an appointment (block or
 * exam) was created or removed, so the card "Anstehende Termine" shows the
 * change at once and not after the cache time. A failing cache must never fail
 * the write that already happened.
 */
export function refreshTraineeDashboard(): void {
  try {
    apiCache.invalidate('trainee_dashboard');
  } catch (err) {
    console.warn('Could not refresh the trainee dashboard cache', err);
  }
}
