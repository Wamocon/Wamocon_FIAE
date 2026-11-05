/**
 * Inventory of the pages of the platform against the targets of the HAI
 * navigation.
 *
 * Every page of src/app (`page.tsx`) is listed here, either with the target that
 * opens it (a static target of targets.ts or a page with a record id) or with the
 * reason why it is deliberately no target. A test reads the real routes of
 * src/app and fails when a page is missing here, so a new page cannot slip in
 * unnoticed: whoever adds it decides "target" or "exception with a reason".
 *
 * Pure module, no server imports.
 *
 * @module lib/hai/navigation/pageInventory
 */

import type { StaticTargetId } from './targets';

export type InventoryEntry =
  /** A static target of targets.ts (for the levels that have it). */
  | { target: StaticTargetId }
  /** A page with a record id: the content type whose resolution builds the path. */
  | { record: 'enabler' | 'use_case' | 'course' }
  /** Deliberately no target, with the reason. */
  | { exception: string };

const PUBLIC =
  'Öffentliche Seite oder Anmeldung, nicht Teil der angemeldeten Oberfläche';
const WRITE = 'Schreibseite (legt etwas an), eine Navigation schreibt nie';
const QUIZ =
  'Durchführung oder Editor eines Quiz, der Weg führt über den Enabler (Reihenfolge der Arbeit, Lösungsschutz)';
const PERSON =
  'Seite zu einer einzelnen Person oder Abgabe, der Weg führt über die Liste (Zuständigkeit, Datenschutz)';
const IMPORT_RUN =
  'Detailseite eines Importlaufs, nicht über einen Namen ansprechbar, der Weg führt über den Inhalts-Import';
const LERNFELD =
  'Detailseite eines Lernfelds, erreichbar über die Berufsschule (noch kein Ziel nach Titel)';

/** Route (as in src/app, without `page.tsx`) to its target or its reason. */
export const PAGE_INVENTORY: Readonly<Record<string, InventoryEntry>> =
  Object.freeze({
    // public
    '/': { exception: PUBLIC },
    '/login': { exception: PUBLIC },
    '/register': { exception: PUBLIC },
    '/forgot-password': { exception: PUBLIC },
    '/reset-password': { exception: PUBLIC },
    '/verify/[code]': { exception: PUBLIC },
    '/ausbildung': { exception: PUBLIC },
    '/berufswahl': { exception: PUBLIC },
    '/demo': { exception: PUBLIC },
    '/demo/trainee/activity-reports': { exception: PUBLIC },
    '/demo/trainee/courses': { exception: PUBLIC },
    '/demo/trainee/dashboard': { exception: PUBLIC },
    '/demo/trainee/profile': { exception: PUBLIC },
    '/demo/trainee/school': { exception: PUBLIC },
    '/demo/trainer/activity-reports': { exception: PUBLIC },
    '/demo/trainer/content-management': { exception: PUBLIC },
    '/demo/trainer/dashboard': { exception: PUBLIC },
    '/demo/trainer/trainees': { exception: PUBLIC },

    // trainee
    '/trainee/activity-reports': { target: 'activity_reports' },
    '/trainee/courses': { target: 'courses' },
    '/trainee/dashboard': { target: 'dashboard' },
    '/trainee/enablers/[enablerId]': { record: 'enabler' },
    '/trainee/enablers/[enablerId]/quiz': { exception: QUIZ },
    '/trainee/evaluations': { target: 'evaluations' },
    '/trainee/lernfelder/[id]': { exception: LERNFELD },
    '/trainee/modules/[moduleId]': { record: 'course' },
    '/trainee/profile': { target: 'profile' },
    '/trainee/quizzes': { target: 'quizzes' },
    '/trainee/quizzes/[quizId]': { exception: QUIZ },
    '/trainee/school': { target: 'school' },
    '/trainee/trainer-feedback': { target: 'trainer_feedback' },
    '/trainee/use-cases/[useCaseId]': { record: 'use_case' },

    // trainer and admin
    '/trainer/activity-reports': { target: 'activity_reports' },
    '/trainer/activity-reports/arbeitszeugnis': { target: 'certificate' },
    '/trainer/admin/content-stats': { target: 'statistics' },
    '/trainer/admin/content-upload': { target: 'content_upload' },
    '/trainer/admin/content-upload/[runId]': { exception: IMPORT_RUN },
    '/trainer/admin/content-upload/new': { exception: WRITE },
    '/trainer/admin/hai': { target: 'hai_admin' },
    '/trainer/admin/hai-memory': { target: 'hai_memory' },
    '/trainer/admin/organizations': { target: 'organizations' },
    '/trainer/admin/users': { target: 'users' },
    '/trainer/calendar': { target: 'calendar' },
    '/trainer/content-management': { target: 'content_management' },
    '/trainer/content-management/[moduleId]/edit': { record: 'course' },
    '/trainer/content-management/new': { exception: WRITE },
    '/trainer/dashboard': { target: 'dashboard' },
    '/trainer/enablers/[enablerId]/quiz': { exception: QUIZ },
    '/trainer/enablers/[enablerId]/quizzes/[quizId]': { exception: QUIZ },
    '/trainer/enablers/[enablerId]/quizzes/new': { exception: WRITE },
    '/trainer/evaluations': { target: 'evaluations' },
    '/trainer/lernfelder/[id]': { exception: LERNFELD },
    '/trainer/profile': { target: 'profile' },
    '/trainer/quiz-management': { target: 'quizzes' },
    '/trainer/quiz-management/[quizId]': { exception: QUIZ },
    '/trainer/quiz-management/new-quiz': { exception: WRITE },
    '/trainer/reviews': { target: 'reviews' },
    '/trainer/reviews/quizzes/[submissionId]': { exception: PERSON },
    '/trainer/school': { target: 'school' },
    '/trainer/trainees': { target: 'trainees' },
    '/trainer/trainees/[traineeId]': { exception: PERSON },
    '/trainer/use-cases/[useCaseId]': { record: 'use_case' },
  });

/** The pages that are deliberately no target, with their reasons. */
export function inventoryExceptions(): Array<{
  route: string;
  reason: string;
}> {
  return Object.entries(PAGE_INVENTORY).flatMap(([route, entry]) =>
    'exception' in entry ? [{ route, reason: entry.exception }] : []
  );
}
