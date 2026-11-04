/**
 * Allow list of the navigation targets of the HAI (agent layer, guidance).
 *
 * The model never picks a path. Every path the HAI can offer is on this list:
 * a fixed set of static pages per level, plus two page shapes with a record id
 * (an enabler and a use case of the trainee). The paths are the real routes of
 * src/app, nothing is invented here.
 *
 * Levels (decided on the server from the session, never from the message):
 *  - TRAINEE: a trainee
 *  - TRAINER: trainer level without an admin role
 *  - ADMIN: an admin level (SUPER_ADMIN, ADMIN, TEMP_ADMIN), sees the entries of
 *    the trainer level too
 *
 * Pure module without server imports: the server (offer), the client (check of
 * an offer before it is opened) and the tests share it.
 *
 * @module lib/hai/navigation/targets
 */

export type NavigationLevel = 'TRAINEE' | 'TRAINER' | 'ADMIN';

export type StaticTargetId =
  | 'dashboard'
  | 'activity_reports'
  | 'school'
  | 'calendar'
  | 'profile'
  | 'quizzes'
  | 'courses'
  | 'trainer_feedback'
  | 'trainees'
  | 'reviews'
  | 'content_management'
  | 'statistics'
  | 'organizations'
  | 'users'
  | 'evaluations'
  | 'certificate'
  | 'content_upload'
  | 'hai_admin'
  | 'hai_memory';

/** One page for one level: the path, the label of the button, the reason. */
export interface LevelTarget {
  path: string;
  /** Name of the page as the person knows it from the menu (German). */
  label: string;
  /** One short sentence: why this page (German). */
  reason: string;
}

type TargetDefinition = Partial<Record<NavigationLevel, LevelTarget>>;

export const STATIC_TARGETS: Readonly<
  Record<StaticTargetId, TargetDefinition>
> = Object.freeze({
  dashboard: {
    TRAINEE: {
      path: '/trainee/dashboard',
      label: 'Dashboard',
      reason: 'Dort siehst du deinen Überblick auf einen Blick.',
    },
    TRAINER: {
      path: '/trainer/dashboard',
      label: 'Dashboard',
      reason: 'Dort siehst du den Überblick über deine Auszubildenden.',
    },
  },
  activity_reports: {
    TRAINEE: {
      path: '/trainee/activity-reports',
      label: 'Ausbildungsnachweis',
      reason:
        'Dort führst du dein Berichtsheft mit den wöchentlichen Tätigkeitsnachweisen.',
    },
    TRAINER: {
      path: '/trainer/activity-reports',
      label: 'Ausbildungsnachweise',
      reason: 'Dort prüfst du die Berichte deiner Auszubildenden.',
    },
  },
  school: {
    TRAINEE: {
      path: '/trainee/school',
      label: 'Berufsschule',
      reason:
        'Dort findest du Lernfelder, Blockkalender, Prüfungen und Notizen zur Berufsschule.',
    },
    TRAINER: {
      path: '/trainer/school',
      label: 'Berufsschule',
      reason:
        'Dort verwaltest du Kalender, Ausbildungsnachweise und Prüfungen.',
    },
  },
  calendar: {
    TRAINEE: {
      path: '/trainee/school?tab=calendar',
      label: 'Blockkalender',
      reason: 'Dort siehst du deine Schul- und Betriebsblöcke.',
    },
    TRAINER: {
      path: '/trainer/calendar',
      label: 'Kalender',
      reason: 'Dort siehst du die Blöcke und Termine.',
    },
  },
  profile: {
    TRAINEE: {
      path: '/trainee/profile',
      label: 'Profil',
      reason: 'Dort pflegst du deine persönlichen Angaben.',
    },
    TRAINER: {
      path: '/trainer/profile',
      label: 'Profil',
      reason: 'Dort pflegst du deine persönlichen Angaben.',
    },
  },
  quizzes: {
    TRAINEE: {
      path: '/trainee/quizzes',
      label: 'Quizze',
      reason: 'Dort findest du die Quizze zu deinem Lernstoff.',
    },
    TRAINER: {
      path: '/trainer/quiz-management',
      label: 'Quizze',
      reason: 'Dort verwaltest du die Quizze.',
    },
  },
  // The menu entry "Lernen" of a trainee. A trainer has no such page, the
  // courses of the trainer level are managed in the content management.
  courses: {
    TRAINEE: {
      path: '/trainee/courses',
      label: 'Lernen',
      reason: 'Dort findest du deine Kurse mit Enablern und Use Cases.',
    },
    TRAINER: {
      path: '/trainer/content-management',
      label: 'Inhaltsverwaltung',
      reason: 'Dort verwaltest du Kurse, Enabler und Use Cases.',
    },
  },
  trainer_feedback: {
    TRAINEE: {
      path: '/trainee/trainer-feedback',
      label: 'Ausbilder-Feedback',
      reason:
        'Dort siehst du die Rückmeldungen deines Ausbilders zu deinen Abgaben.',
    },
  },
  trainees: {
    TRAINER: {
      path: '/trainer/trainees',
      label: 'Auszubildende',
      reason: 'Dort siehst du deine Auszubildenden mit ihrem Fortschritt.',
    },
  },
  reviews: {
    TRAINER: {
      path: '/trainer/reviews',
      label: 'Offene Bewertungen',
      reason: 'Dort siehst du, was noch bewertet werden muss.',
    },
  },
  content_management: {
    TRAINER: {
      path: '/trainer/content-management',
      label: 'Inhaltsverwaltung',
      reason: 'Dort verwaltest du Kurse, Enabler und Use Cases.',
    },
  },
  // A plain trainer has no page of its own for statistics, the numbers about
  // the trainees are on the dashboard. The admin levels have the page for
  // the content statistics.
  statistics: {
    TRAINER: {
      path: '/trainer/dashboard',
      label: 'Dashboard mit Statistik',
      reason: 'Dort siehst du die Kennzahlen deiner Auszubildenden.',
    },
    ADMIN: {
      path: '/trainer/admin/content-stats',
      label: 'Inhaltsstatistik',
      reason: 'Dort siehst du, wie viel Inhalt je Beruf vorhanden ist.',
    },
  },
  organizations: {
    ADMIN: {
      path: '/trainer/admin/organizations',
      label: 'Organisationen',
      reason: 'Dort verwaltest du Organisationen und ihre Berufe.',
    },
  },
  users: {
    ADMIN: {
      path: '/trainer/admin/users',
      label: 'Benutzerverwaltung',
      reason: 'Dort verwaltest du die Benutzer.',
    },
  },
  // Weekly evaluations (self rating of the trainee, rating of the trainer)
  evaluations: {
    TRAINEE: {
      path: '/trainee/evaluations',
      label: 'Wochenbewertung',
      reason:
        'Dort bewertest du deine Woche und siehst die Bewertung deines Ausbilders.',
    },
    TRAINER: {
      path: '/trainer/evaluations',
      label: 'Wochenbewertungen',
      reason: 'Dort prüfst du die Bewertungen deiner Auszubildenden.',
    },
  },
  // Menu entry "Azubi-Arbeitszeugnis" of the trainer
  certificate: {
    TRAINER: {
      path: '/trainer/activity-reports/arbeitszeugnis',
      label: 'Azubi-Arbeitszeugnis',
      reason:
        'Dort erstellst du ein Zeugnis aus den genehmigten Ausbildungsnachweisen.',
    },
  },
  content_upload: {
    ADMIN: {
      path: '/trainer/admin/content-upload',
      label: 'Inhalts-Import',
      reason: 'Dort importierst du neue Inhalte und prüfst die Läufe.',
    },
  },
  hai_admin: {
    ADMIN: {
      path: '/trainer/admin/hai',
      label: 'HAI-Verwaltung',
      reason: 'Dort verwaltest du den Index und die Einstellungen der HAI.',
    },
  },
  hai_memory: {
    ADMIN: {
      path: '/trainer/admin/hai-memory',
      label: 'HAI-Gedächtnis',
      reason: 'Dort siehst du die Verwaltung des Gedächtnisses der HAI.',
    },
  },
});

/**
 * The names of the menu entries of the sidebar, in its order, as the person
 * reads them (src/locales/de.json, keys nav.*). The prompt names these and no
 * other entry, so the model does not invent a menu ("Auszubildenden-Übersicht
 * auf deinem Dashboard"). The trainer level also reaches the pages of the admin
 * entries through the platform, the sidebar of an admin shows more entries.
 */
export const MENU_ENTRY_NAMES: Readonly<
  Record<'TRAINEE' | 'TRAINER', readonly string[]>
> = Object.freeze({
  TRAINEE: [
    'Dashboard',
    'Ausbildungsnachweis',
    'Berufsschule',
    'Lernen',
    'Ausbilder-Feedback',
    'Quizze',
    'Profil',
  ],
  TRAINER: [
    'Dashboard',
    'Ausbildungsnachweis',
    'Berufsschule',
    'Inhaltsverwaltung',
    'Quiz-Übersicht',
    'Auszubildende',
    'Profil',
  ],
});

export const STATIC_TARGET_IDS = Object.keys(
  STATIC_TARGETS
) as StaticTargetId[];

/**
 * The target for a level, or null when the level has no such page. An admin
 * level has the pages of the trainer level too (admins act as trainers).
 */
export function staticTargetFor(
  id: StaticTargetId,
  level: NavigationLevel
): LevelTarget | null {
  const definition = STATIC_TARGETS[id];
  if (!definition) return null;
  const own = definition[level];
  if (own) return own;
  if (level === 'ADMIN') return definition.TRAINER ?? null;
  return null;
}

/** The targets a level may be offered, in the order of the list. */
export function targetsForLevel(
  level: NavigationLevel
): Array<{ id: StaticTargetId } & LevelTarget> {
  const result: Array<{ id: StaticTargetId } & LevelTarget> = [];
  for (const id of STATIC_TARGET_IDS) {
    const target = staticTargetFor(id, level);
    if (target) result.push({ id, ...target });
  }
  return result;
}

// ============================================================================
// PAGES WITH A RECORD ID
// ============================================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_SRC = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The one query parameter a page of the allow list may carry besides its id. */
export const DOCUMENT_PARAM = 'document';
/** Trainer only: the enabler to open in the editor of a course. */
export const ENABLER_PARAM = 'enabler';

function lowerUuid(id: unknown): string | null {
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
}

type SearchInput = string | URLSearchParams | null | undefined;

/**
 * The uuid of one known parameter in a query string, or null. Strict: the query
 * may only hold the known parameters (`document`, and `enabler` on the trainer
 * page), the wanted one exactly once, and it has to be a uuid. Any other
 * parameter, a repeated one or a value that is no uuid gives null, so a crafted
 * link opens nothing.
 */
function strictParam(search: SearchInput, name: string): string | null {
  if (search === null || search === undefined) return null;
  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search;
  const keys = Array.from(params.keys());
  if (keys.some(key => key !== DOCUMENT_PARAM && key !== ENABLER_PARAM)) {
    return null;
  }
  const all = params.getAll(name);
  if (all.length !== 1) return null;
  return lowerUuid(all[0]);
}

/** The uuid in the parameter `document`, or null (see strictParam). */
export function documentIdFromSearch(search: SearchInput): string | null {
  return strictParam(search, DOCUMENT_PARAM);
}

/** The uuid in the parameter `enabler` (trainer editor), or null. */
export function enablerIdFromSearch(search: SearchInput): string | null {
  return strictParam(search, ENABLER_PARAM);
}

function withDocument(path: string, documentId?: string | null): string | null {
  if (documentId === undefined || documentId === null) return path;
  const doc = lowerUuid(documentId);
  return doc ? `${path}?${DOCUMENT_PARAM}=${doc}` : null;
}

/**
 * Page of an enabler (it holds the quizzes, the material and the scenario of the
 * enabler), optionally with the document that the reader opens right away, or
 * null for a bad id.
 */
export function pathOfEnabler(
  id: string,
  documentId?: string | null
): string | null {
  const enabler = lowerUuid(id);
  return enabler
    ? withDocument(`/trainee/enablers/${enabler}`, documentId)
    : null;
}

/** Page of a use case of the trainee, optionally with a document, or null for a bad id. */
export function pathOfUseCase(
  id: string,
  documentId?: string | null
): string | null {
  const useCase = lowerUuid(id);
  return useCase
    ? withDocument(`/trainee/use-cases/${useCase}`, documentId)
    : null;
}

/** Page of a course of the trainee (the course card of "Lernen"). */
export function pathOfCourse(id: string): string | null {
  const course = lowerUuid(id);
  return course ? `/trainee/modules/${course}` : null;
}

/** Trainer: the course in the content management (it lists its enablers and use cases). */
export function trainerPathOfCourse(id: string): string | null {
  const course = lowerUuid(id);
  return course ? `/trainer/content-management/${course}/edit` : null;
}

/**
 * Trainer: an enabler is opened in the editor of its course (the parameter
 * `enabler` opens it, a `document` shows a file of it in the reader).
 */
export function trainerPathOfEnabler(
  courseId: string,
  enablerId: string,
  documentId?: string | null
): string | null {
  const course = lowerUuid(courseId);
  const enabler = lowerUuid(enablerId);
  if (!course || !enabler) return null;
  const base = `/trainer/content-management/${course}/edit?${ENABLER_PARAM}=${enabler}`;
  if (documentId === undefined || documentId === null) return base;
  const doc = lowerUuid(documentId);
  return doc ? `${base}&${DOCUMENT_PARAM}=${doc}` : null;
}

/** Trainer: the page of a use case, optionally with a document. */
export function trainerPathOfUseCase(
  id: string,
  documentId?: string | null
): string | null {
  const useCase = lowerUuid(id);
  return useCase
    ? withDocument(`/trainer/use-cases/${useCase}`, documentId)
    : null;
}

const ALLOWED_STATIC_PATHS: ReadonlySet<string> = new Set(
  STATIC_TARGET_IDS.flatMap(id =>
    Object.values(STATIC_TARGETS[id]).map(target => target.path)
  )
);

/**
 * The forms of the pages with a record id. Exact patterns, one known parameter
 * at most: a uuid in the path, and `document` (uuid), on the trainer editor
 * `enabler` (uuid) and `document`. Nothing else passes.
 */
const DYNAMIC_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `^/trainee/(?:enablers|use-cases)/${UUID_SRC}(?:\\?document=${UUID_SRC})?$`
  ),
  new RegExp(`^/trainee/modules/${UUID_SRC}$`),
  new RegExp(`^/trainer/use-cases/${UUID_SRC}(?:\\?document=${UUID_SRC})?$`),
  new RegExp(
    `^/trainer/content-management/${UUID_SRC}/edit(?:\\?enabler=${UUID_SRC}(?:&document=${UUID_SRC})?)?$`
  ),
];

/**
 * Whether a path is on the allow list: one of the static pages, or a page with a
 * record id in one of the exact forms above. Exact match only, so no other
 * path, no address with a host, no other parameter and no traversal passes.
 */
export function isAllowedNavigationPath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  return (
    ALLOWED_STATIC_PATHS.has(path) ||
    DYNAMIC_PATTERNS.some(pattern => pattern.test(path))
  );
}
