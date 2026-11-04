/**
 * Counter for the outcome of navigation requests, so gaps become visible: a
 * request to open something that ended without a page (no target, nothing found,
 * a role that has no such page) is counted with its reason.
 *
 * Only tokens are ever recorded: the kind of the request, the outcome, the level
 * and whether it was spoken. NEVER the text of the message, a title, a name or an
 * id (the same rule as the measuring points of the voice assistant, see
 * src/lib/hai/voice/client/trace.ts). The counter lives in the memory of the
 * server instance and is written as one JSON line per request (`hai.navigation`)
 * for the log of the platform.
 *
 * @module lib/hai/navigation/metrics
 */

import type { NavigationIntent } from './intent';
import type { NavigationOutcomeKind } from './resolve';

export interface NavigationMetric {
  /** The kind of the recognized request (static, course, document, ...). */
  intent: NavigationIntent['kind'] | 'follow_up';
  /** What the platform answered: a page, cards, a reason. */
  outcome: NavigationOutcomeKind | 'follow_up_ask' | 'error';
  level: 'TRAINEE' | 'TRAINER' | 'ADMIN';
  voice: boolean;
  /** Whether the answer carried cards (a question back with the nearest targets). */
  choices: boolean;
}

const counters = new Map<string, number>();

/** Outcomes that mean "no page was reached": the gaps to look at. */
export const NO_PAGE_OUTCOMES: ReadonlySet<string> = new Set([
  'denied',
  'unknown_page',
  'not_found',
  'ambiguous',
  'nothing',
  'unavailable',
  'follow_up_ask',
  'error',
]);

/** The key under which a metric is counted: only tokens. */
export function metricKey(metric: NavigationMetric): string {
  return [
    metric.intent,
    metric.outcome,
    metric.level,
    metric.voice ? 'voice' : 'text',
    metric.choices ? 'cards' : 'nocards',
  ].join('|');
}

/** Count one request and write the log line. Never throws. */
export function recordNavigationOutcome(metric: NavigationMetric): void {
  try {
    const key = metricKey(metric);
    counters.set(key, (counters.get(key) ?? 0) + 1);
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        event: 'hai.navigation',
        ...metric,
        gap: NO_PAGE_OUTCOMES.has(metric.outcome),
      })
    );
  } catch {
    // a measuring point never breaks an answer
  }
}

/** The counts since the start of this instance (key to number). */
export function navigationCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

/** For tests. */
export function resetNavigationCounters(): void {
  counters.clear();
}
