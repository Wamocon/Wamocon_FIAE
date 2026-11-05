/**
 * Progress and next step of a trainee for the day companion.
 *
 * Nothing new is calculated: the enablers with their state in the order of work
 * come from the helpers the pages use (loadNextStepEntries, which reads
 * src/lib/catalog/progression-db.ts), the next step from the function of the
 * "Weiter lernen" navigation (pickNextStep). Per occupation (training catalog)
 * of the person, the occupation the person chose in the app (header x-catalog)
 * first. The choice only changes the order, never what is read: the catalogs
 * come from the catalog scope of the user.
 *
 * The day itself is not limited to one occupation (all occupations of the
 * person), only the progress is shown per occupation.
 *
 * @module lib/hai/dayProgress
 */

import { inArray } from 'drizzle-orm';
import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { getCatalogScopeForUserId } from '@/lib/catalog/scope';
import { loadNextStepEntries } from './navigation/data';
import {
  pickNextStep,
  type NextStep,
  type NextStepPlan,
} from './navigation/nextStep';
import { plainText } from './navigation/text';

export interface OccupationProgress {
  catalogId: string;
  code: string;
  title: string;
  /** Active enablers of the courses of the person in this occupation. */
  totalEnablers: number;
  completedEnablers: number;
  progressPercent: number;
  nextStep: NextStep;
}

export interface DayProgress {
  /** Occupations with at least one enabler, the chosen one first. */
  occupations: OccupationProgress[];
  /** A lookup failed: an empty list does not mean "nothing there". */
  failed: boolean;
}

export interface DayProgressOptions {
  /** Code of the occupation chosen in the app (x-catalog), only the order. */
  preferredCatalogCode?: string | null;
  /** Phase plan of the trainee, for the next step (as in the navigation). */
  plan?: NextStepPlan | null;
}

/** Order of the occupations: the chosen one first, the rest as they come. */
function orderCatalogs<T extends { code: string }>(
  catalogs: T[],
  preferredCatalogCode?: string | null
): T[] {
  const preferred = (preferredCatalogCode ?? '').trim().toLowerCase();
  if (!preferred) return catalogs;
  const index = catalogs.findIndex(c => c.code.toLowerCase() === preferred);
  if (index <= 0) return catalogs;
  const ordered = [...catalogs];
  ordered.unshift(...ordered.splice(index, 1));
  return ordered;
}

/**
 * Progress and next step per occupation of the trainee. Never throws: a failed
 * lookup is reported with `failed`, so the answer can say "could not be loaded"
 * instead of "nothing there".
 */
export async function loadDayProgress(
  userId: string,
  options: DayProgressOptions = {}
): Promise<DayProgress> {
  try {
    // Only content of the occupations of the user (fail closed: no scope, none)
    const scope = await getCatalogScopeForUserId(userId);
    if (!scope || scope.allowedCatalogIds.length === 0) {
      return { occupations: [], failed: false };
    }

    const rows = (await db
      .select({
        id: trainingCatalogs.id,
        code: trainingCatalogs.code,
        title: trainingCatalogs.title,
      })
      .from(trainingCatalogs)
      .where(inArray(trainingCatalogs.id, scope.allowedCatalogIds))) as Array<{
      id: string;
      code: string;
      title: string;
    }>;
    const byId = new Map(rows.map(r => [String(r.id), r]));
    const catalogs = orderCatalogs(
      scope.allowedCatalogIds
        .map(id => byId.get(String(id)))
        .filter((r): r is { id: string; code: string; title: string } => !!r),
      options.preferredCatalogCode
    );

    // The occupations do not depend on each other: they are read side by side
    // (the order of the result is the order of the catalogs, as before)
    const loaded = await Promise.all(
      catalogs.map(async (catalog): Promise<OccupationProgress | 'failed' | null> => {
        try {
          const entries = await loadNextStepEntries(userId, [
            String(catalog.id),
          ]);
          if (entries.length === 0) return null;
          const completed = entries.filter(e => e.completed).length;
          return {
            catalogId: String(catalog.id),
            code: String(catalog.code),
            title: String(catalog.title),
            totalEnablers: entries.length,
            completedEnablers: completed,
            progressPercent: Math.round((completed / entries.length) * 100),
            nextStep: pickNextStep(entries, options.plan),
          };
        } catch (error) {
          console.warn(
            'HAI.ai DayProgress: occupation could not be loaded:',
            error
          );
          return 'failed';
        }
      })
    );
    const occupations: OccupationProgress[] = [];
    let failed = false;
    for (const result of loaded) {
      if (result === 'failed') failed = true;
      else if (result) occupations.push(result);
    }
    return { occupations, failed };
  } catch (error) {
    console.warn('HAI.ai DayProgress: progress could not be loaded:', error);
    return { occupations: [], failed: true };
  }
}

function nextStepLine(step: NextStep): string | null {
  switch (step.kind) {
    case 'next':
      return `  Nächster Schritt: Enabler "${plainText(step.entry.title)}". ${step.reason}`;
    case 'all_done':
      return '  Alle freigeschalteten Enabler sind abgeschlossen.';
    case 'all_locked':
      return '  Zurzeit ist kein weiterer Enabler freigeschaltet (Reihenfolge der Arbeit oder Sperre des Trainers).';
    case 'none':
      return null;
  }
}

/**
 * The progress block of the day: one line per occupation with the number of
 * completed enablers and the next step. With several occupations each one is
 * named, the chosen one first and marked. Plain facts for the model, an empty
 * result says so in words.
 */
export function formatDayProgress(
  progress: DayProgress,
  preferredCatalogCode?: string | null
): string {
  if (progress.occupations.length === 0) {
    return progress.failed
      ? '**Fortschritt:** Konnte gerade nicht geladen werden.'
      : '**Fortschritt:** Es ist noch kein Kurs mit Enablern für dich freigeschaltet.';
  }

  const several = progress.occupations.length > 1;
  const preferred = (preferredCatalogCode ?? '').trim().toLowerCase();
  const lines: string[] = [
    several
      ? '**Fortschritt und nächster Schritt je Beruf:**'
      : '**Fortschritt und nächster Schritt:**',
  ];
  for (const o of progress.occupations) {
    const chosen =
      several && preferred !== '' && o.code.toLowerCase() === preferred;
    lines.push(
      `- ${plainText(o.title)}${chosen ? ' (gewählter Beruf)' : ''}: ${o.completedEnablers} von ${o.totalEnablers} Enablern abgeschlossen (${o.progressPercent}%)`
    );
    const next = nextStepLine(o.nextStep);
    if (next) lines.push(next);
  }
  if (progress.failed) {
    lines.push('Ein Teil des Fortschritts konnte gerade nicht geladen werden.');
  }
  return lines.join('\n');
}
