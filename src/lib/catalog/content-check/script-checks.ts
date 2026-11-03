/**
 * The script checks of the content check (no AI, deterministic): consistency
 * of the content of ONE training catalog. Every rule is a pure function over
 * the snapshot (snapshot.ts) and returns findings (types.ts) with the objects
 * concerned in `refs`: at most MAX_REFS per rule, the total number is in
 * `details`. A rule that finds nothing returns an empty list.
 *
 * Severity: `error` breaks what a trainee sees or does (a quiz without a
 * correct answer, an enabler without quizzes, a document without a file),
 * `warning` is a gap or an inconsistency a person should look at, `info` is a
 * note that may be on purpose.
 *
 * Rules that compare with the plan (targets and hours of the phase plan) carry
 * `source: 'plan'`, everything else `source: 'script'`.
 *
 * Not checked, on purpose: whether the file of a document exists in the
 * storage (the storage access only downloads, and downloading every file is far
 * too heavy for an admin page) and whether two documents are byte identical (the
 * table has no checksum). The copy rule below therefore only reports documents
 * with the same size and page count in different enablers.
 */

import {
  CONTENT_METRICS,
  type ContentMetricId,
} from '@/lib/catalog/content-targets';
import type { CatalogContentStats } from '@/lib/catalog/content-targets';
import type {
  ContentSnapshot,
  QuizDifficulty,
  SnapshotCourse,
  SnapshotDocument,
  SnapshotEnabler,
  SnapshotUseCase,
} from '@/lib/catalog/content-check/snapshot';
import {
  gluedWords,
  hasBrokenEncoding,
  normalizeTitle,
} from '@/lib/catalog/content-check/title-rules';
import { resolvePhasePlan } from '@/lib/catalog/phase-plan';
import type {
  Finding,
  FindingRef,
  FindingRefType,
  FindingSeverity,
  FindingSource,
} from '@/lib/catalog/content-check/types';

/** Most objects named in one finding. */
export const MAX_REFS = 20;

/** Weeks a phase may differ from the sum of its components before it is reported. */
const PHASE_TOLERANCE_WEEKS = 2;

const LEVELS: readonly QuizDifficulty[] = ['LOW', 'MEDIUM', 'HIGH'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clip = (text: string, max = 80): string => {
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};

const ref = (type: FindingRefType, id: string, label: string): FindingRef => ({
  type,
  id,
  label: clip(label) || id,
});

interface Spec {
  rule: string;
  severity: FindingSeverity;
  category: string;
  source?: FindingSource;
  /** One sentence, gets the number in front where `{n}` stands. */
  summary: (total: number) => string;
  hint?: string;
  /** Optional extra sentence for `details`. */
  detail?: string;
}

/** A finding for a list of objects, or no finding for an empty list. */
function group(spec: Spec, refs: FindingRef[]): Finding[] {
  if (refs.length === 0) return [];
  const total = refs.length;
  const shown = refs.slice(0, MAX_REFS);
  const count =
    total > shown.length
      ? `Betroffen: ${total}, genannt: die ersten ${shown.length}.`
      : `Betroffen: ${total}.`;
  return [
    {
      rule: spec.rule,
      severity: spec.severity,
      source: spec.source ?? 'script',
      category: spec.category,
      summary: spec.summary(total),
      details: spec.detail ? `${count} ${spec.detail}` : count,
      refs: shown,
      ...(spec.hint ? { hint: spec.hint } : {}),
    },
  ];
}

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? `1 ${one}` : `${n} ${many}`;

/** Lookup tables over the snapshot, built once per run. */
export interface Index {
  snap: ContentSnapshot;
  courseById: Map<string, SnapshotCourse>;
  enablerById: Map<string, SnapshotEnabler>;
  /** Documents at an enabler (no use case). */
  docsOfEnabler: Map<string, SnapshotDocument[]>;
  docsOfUseCase: Map<string, SnapshotDocument[]>;
  useCasesOfEnabler: Map<string, SnapshotUseCase[]>;
  enablersOfCourse: Map<string, SnapshotEnabler[]>;
  useCasesOfCourse: Map<string, SnapshotUseCase[]>;
  /** Quiz levels per enabler, only quizzes with a known level. */
  quizzesOfEnabler: Map<string, Map<QuizDifficulty, number>>;
  enablerLabel: (e: SnapshotEnabler) => string;
  useCaseLabel: (u: SnapshotUseCase) => string;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function buildIndex(snap: ContentSnapshot): Index {
  const courseById = new Map(snap.courses.map(c => [c.id, c]));
  const enablerById = new Map(snap.enablers.map(e => [e.id, e]));
  const docsOfEnabler = new Map<string, SnapshotDocument[]>();
  const docsOfUseCase = new Map<string, SnapshotDocument[]>();
  for (const d of snap.documents) {
    if (d.useCaseId) push(docsOfUseCase, d.useCaseId, d);
    else if (d.enablerId) push(docsOfEnabler, d.enablerId, d);
  }
  const useCasesOfEnabler = new Map<string, SnapshotUseCase[]>();
  const useCasesOfCourse = new Map<string, SnapshotUseCase[]>();
  for (const u of snap.useCases) {
    if (u.enablerId) push(useCasesOfEnabler, u.enablerId, u);
    push(useCasesOfCourse, u.courseId, u);
  }
  const enablersOfCourse = new Map<string, SnapshotEnabler[]>();
  for (const e of snap.enablers) push(enablersOfCourse, e.courseId, e);
  const quizzesOfEnabler = new Map<string, Map<QuizDifficulty, number>>();
  for (const z of snap.quizzes) {
    if (z.type !== 'LESSON' || !z.enablerId || !z.difficulty) continue;
    const levels = quizzesOfEnabler.get(z.enablerId) ?? new Map();
    levels.set(z.difficulty, (levels.get(z.difficulty) ?? 0) + 1);
    quizzesOfEnabler.set(z.enablerId, levels);
  }
  const courseName = (id: string) => {
    const c = courseById.get(id);
    return c ? (c.code ?? clip(c.title, 36)) : '?';
  };
  return {
    snap,
    courseById,
    enablerById,
    docsOfEnabler,
    docsOfUseCase,
    useCasesOfEnabler,
    enablersOfCourse,
    useCasesOfCourse,
    quizzesOfEnabler,
    enablerLabel: e =>
      `${courseName(e.courseId)} / ${e.code ?? `Nr. ${e.orderIndex}`}: ${e.title}`,
    useCaseLabel: u =>
      `${courseName(u.courseId)} / ${u.code ?? `Nr. ${u.orderIndex}`}: ${u.title}`,
  };
}

const courseLabel = (c: SnapshotCourse): string =>
  c.code ? `${c.code}: ${c.title}` : c.title;

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/** A course (component) without any enabler. */
export function courseWithoutEnabler(ix: Index): Finding[] {
  const refs = ix.snap.courses
    .filter(c => !(ix.enablersOfCourse.get(c.id)?.length ?? 0))
    .map(c => ref('course', c.id, courseLabel(c)));
  return group(
    {
      rule: 'course.enabler.missing',
      severity: 'error',
      category: 'structure',
      summary: n =>
        `${plural(n, 'Komponente hat', 'Komponenten haben')} keinen Enabler.`,
      hint: 'Enabler anlegen oder importieren, sonst ist die Komponente für Azubis leer.',
    },
    refs
  );
}

/** Enablers whose course is missing or belongs to another catalog. */
export function catalogMismatch(ix: Index): Finding[] {
  const orphan: FindingRef[] = [];
  const other: FindingRef[] = [];
  for (const e of ix.snap.enablers) {
    if (e.courseCatalogId === null) {
      orphan.push(ref('enabler', e.id, ix.enablerLabel(e)));
    } else if (e.courseCatalogId !== e.catalogId) {
      other.push(ref('enabler', e.id, ix.enablerLabel(e)));
    }
  }
  const quizzes = ix.snap.quizzes
    .filter(
      z => z.enablerCatalogId !== null && z.enablerCatalogId !== z.catalogId
    )
    .map(z => ref('quiz', z.id, z.title));
  const useCases = ix.snap.useCases
    .filter(u => {
      const e = u.enablerId ? ix.enablerById.get(u.enablerId) : undefined;
      return e !== undefined && e.catalogId !== u.catalogId;
    })
    .map(u => ref('useCase', u.id, ix.useCaseLabel(u)));
  return [
    ...group(
      {
        rule: 'enabler.course.missing',
        severity: 'error',
        category: 'structure',
        summary: n =>
          `${plural(n, 'Enabler hat', 'Enabler haben')} keinen Kurs.`,
        hint: 'Den Enabler einem Kurs zuordnen oder löschen.',
      },
      orphan
    ),
    ...group(
      {
        rule: 'enabler.catalog.mismatch',
        severity: 'error',
        category: 'structure',
        summary: n =>
          `${plural(n, 'Enabler gehört', 'Enabler gehören')} zu einer anderen Ausbildung als ihr Kurs.`,
        hint: 'Die Zuordnung zur Ausbildung korrigieren, sonst erscheint der Inhalt im falschen Beruf.',
      },
      other
    ),
    ...group(
      {
        rule: 'quiz.catalog.mismatch',
        severity: 'error',
        category: 'structure',
        summary: n =>
          `${plural(n, 'Quiz gehört', 'Quizze gehören')} zu einer anderen Ausbildung als ihr Enabler.`,
        hint: 'Quiz und Enabler derselben Ausbildung zuordnen.',
      },
      quizzes
    ),
    ...group(
      {
        rule: 'usecase.catalog.mismatch',
        severity: 'error',
        category: 'structure',
        summary: n =>
          `${plural(n, 'Use Case gehört', 'Use Cases gehören')} zu einer anderen Ausbildung als ihr Enabler.`,
        hint: 'Use Case und Enabler derselben Ausbildung zuordnen.',
      },
      useCases
    ),
  ];
}

/** Phase plan components that no course is linked to (where courses are linked at all). */
export function componentWithoutCourse(ix: Index): Finding[] {
  const linked = new Set(
    ix.snap.courses
      .map(c => c.trainingComponentId)
      .filter((id): id is string => id !== null)
  );
  // An occupation without any link (FIAE: courses without a component row) is
  // no deviation of its own: there is nothing to compare with
  if (linked.size === 0) return [];
  const refs = ix.snap.components
    .filter(t => !linked.has(t.id))
    .map(t => ref('catalog', t.id, `${t.code}: ${t.title}`));
  return group(
    {
      rule: 'component.course.missing',
      severity: 'warning',
      category: 'structure',
      summary: n =>
        `${plural(n, 'Komponente des Phasenplans hat', 'Komponenten des Phasenplans haben')} keinen Kurs.`,
      hint: 'Den Kurs der Komponente zuordnen, sonst gibt es dazu keinen Lerninhalt.',
    },
    refs
  );
}

/** Enablers without a use case and use cases without an enabler. */
export function useCaseLinks(ix: Index): Finding[] {
  const enablers = ix.snap.enablers
    .filter(e => !(ix.useCasesOfEnabler.get(e.id)?.length ?? 0))
    .map(e => ref('enabler', e.id, ix.enablerLabel(e)));
  const useCases = ix.snap.useCases
    .filter(u => u.enablerId === null)
    .map(u => ref('useCase', u.id, ix.useCaseLabel(u)));
  return [
    // No use case at all in the catalog is a decision, not a gap per enabler
    ...(ix.snap.useCases.length === 0
      ? []
      : group(
          {
            rule: 'enabler.usecase.missing',
            severity: 'warning',
            category: 'structure',
            summary: n =>
              `${plural(n, 'Enabler hat', 'Enabler haben')} keinen Use Case.`,
            hint: 'Den Use Case des Enablers anlegen oder importieren.',
          },
          enablers
        )),
    ...group(
      {
        rule: 'usecase.enabler.missing',
        severity: 'warning',
        category: 'structure',
        summary: n =>
          `${plural(n, 'Use Case ist', 'Use Cases sind')} keinem Enabler zugeordnet.`,
        hint: 'Den Use Case einem Enabler desselben Kurses zuordnen.',
      },
      useCases
    ),
  ];
}

/** Values of `order_index` that repeat or skip a number inside one course. */
function orderFindings(
  kind: 'enabler' | 'usecase',
  groups: Map<string, { index: number; ref: FindingRef }[]>
): Finding[] {
  const duplicates: FindingRef[] = [];
  const gaps: FindingRef[] = [];
  for (const items of groups.values()) {
    const seen = new Map<number, number>();
    for (const item of items) {
      seen.set(item.index, (seen.get(item.index) ?? 0) + 1);
    }
    const doubled = [...seen.entries()].filter(([, n]) => n > 1);
    for (const [index] of doubled) {
      const first = items.find(i => i.index === index);
      if (first) duplicates.push(first.ref);
    }
    const sorted = [...seen.keys()].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i] - sorted[i - 1] > 1) {
        const after = items.find(item => item.index === sorted[i]);
        if (after) gaps.push(after.ref);
        break;
      }
    }
  }
  const noun = kind === 'enabler' ? 'Enablern' : 'Use Cases';
  return [
    ...group(
      {
        rule: `${kind}.order.duplicate`,
        severity: 'warning',
        category: 'structure',
        summary: n =>
          `In ${plural(n, 'Kurs', 'Kursen')} steht dieselbe Reihenfolgenummer bei mehreren ${noun}.`,
        hint: 'Die Reihenfolge eindeutig nummerieren, sonst ist die Reihe der Anzeige nicht festgelegt.',
      },
      duplicates
    ),
    ...group(
      {
        rule: `${kind}.order.gap`,
        severity: 'info',
        category: 'structure',
        summary: n =>
          `In ${plural(n, 'Kurs', 'Kursen')} fehlt eine Nummer in der Reihenfolge der ${noun}.`,
        detail:
          'Das Ziel ist die erste Nummer nach der Lücke. Eine Lücke kann gewollt sein (ein Enabler wurde entfernt).',
        hint: 'Prüfen, ob ein Enabler fehlt, sonst nichts tun.',
      },
      gaps
    ),
  ];
}

/** `order_index` with duplicates or gaps per course (enablers and use cases). */
export function orderIndexRules(ix: Index): Finding[] {
  const enablers = new Map<string, { index: number; ref: FindingRef }[]>();
  for (const e of ix.snap.enablers) {
    push(enablers, e.courseId, {
      index: e.orderIndex,
      ref: ref('enabler', e.id, ix.enablerLabel(e)),
    });
  }
  const useCases = new Map<string, { index: number; ref: FindingRef }[]>();
  for (const u of ix.snap.useCases) {
    push(useCases, u.courseId, {
      index: u.orderIndex,
      ref: ref('useCase', u.id, ix.useCaseLabel(u)),
    });
  }
  return [
    ...orderFindings('enabler', enablers),
    ...orderFindings('usecase', useCases),
  ];
}

/** Active enablers in a course that is not active (trainees do not see them). */
export function inactiveCourseWithActiveEnablers(ix: Index): Finding[] {
  const refs = ix.snap.courses
    .filter(
      c =>
        !c.isActive &&
        (ix.enablersOfCourse.get(c.id) ?? []).some(e => e.isActive)
    )
    .map(c => ref('course', c.id, courseLabel(c)));
  return group(
    {
      rule: 'course.inactive.activeEnablers',
      severity: 'warning',
      category: 'structure',
      summary: n =>
        `${plural(n, 'Komponente ist', 'Komponenten sind')} nicht freigegeben, enthält aber aktive Enabler.`,
      hint: 'Die Komponente freigeben oder die Enabler deaktivieren, damit der Stand eindeutig ist.',
    },
    refs
  );
}

/** How much of the content is switched off, next to what is active. */
export function inactiveShare(ix: Index): Finding[] {
  const { snap } = ix;
  const kinds: {
    noun: string;
    items: {
      id: string;
      active: boolean;
      type: FindingRefType;
      label: string;
    }[];
  }[] = [
    {
      noun: 'Enabler',
      items: snap.enablers.map(e => ({
        id: e.id,
        active: e.isActive,
        type: 'enabler',
        label: ix.enablerLabel(e),
      })),
    },
    {
      noun: 'Use Cases',
      items: snap.useCases.map(u => ({
        id: u.id,
        active: u.isActive,
        type: 'useCase',
        label: ix.useCaseLabel(u),
      })),
    },
    {
      noun: 'Quizze',
      items: snap.quizzes.map(z => ({
        id: z.id,
        active: z.isActive,
        type: 'quiz',
        label: z.title,
      })),
    },
  ];
  const out: Finding[] = [];
  for (const kind of kinds) {
    const inactive = kind.items.filter(i => !i.active);
    if (inactive.length === 0) continue;
    const total = kind.items.length;
    // A catalog that is not active is allowed to hold inactive content
    const heavy = snap.catalog.isActive && inactive.length * 4 >= total;
    out.push(
      ...group(
        {
          rule: `${kind.noun === 'Enabler' ? 'enabler' : kind.noun === 'Use Cases' ? 'usecase' : 'quiz'}.inactive`,
          severity: heavy ? 'warning' : 'info',
          category: 'structure',
          summary: n =>
            `${n} von ${total} ${kind.noun} sind nicht aktiv (${Math.round((n * 100) / total)} Prozent).`,
          hint: 'Prüfen, ob die inaktiven Inhalte noch freigegeben werden sollen.',
        },
        inactive.map(i => ref(i.type, i.id, i.label))
      )
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quizzes and questions
// ---------------------------------------------------------------------------

/** Enablers without the three lesson quizzes LOW, MEDIUM, HIGH. */
export function enablerQuizzes(ix: Index): Finding[] {
  const refs: FindingRef[] = [];
  for (const e of ix.snap.enablers) {
    const have = ix.quizzesOfEnabler.get(e.id);
    const missing = LEVELS.filter(level => !have?.get(level));
    if (missing.length > 0) {
      refs.push(
        ref(
          'enabler',
          e.id,
          `${ix.enablerLabel(e)} (fehlt: ${missing.join(', ')})`
        )
      );
    }
  }
  return group(
    {
      rule: 'enabler.quiz.missing',
      severity: 'error',
      category: 'quiz',
      summary: n =>
        `${plural(n, 'Enabler hat', 'Enabler haben')} nicht alle drei Lektionsquizze (LOW, MEDIUM, HIGH).`,
      hint: 'Die fehlenden Quizze importieren, ohne Quiz kann der Azubi den Enabler nicht abschließen.',
    },
    refs
  );
}

/** Quizzes without any question. */
export function quizWithoutQuestions(ix: Index): Finding[] {
  const refs = ix.snap.quizzes
    .filter(z => z.questionCount === 0)
    .map(z => ref('quiz', z.id, z.title));
  return group(
    {
      rule: 'quiz.empty',
      severity: 'error',
      category: 'quiz',
      summary: n => `${plural(n, 'Quiz hat', 'Quizze haben')} keine Fragen.`,
      hint: 'Fragen ergänzen oder das Quiz entfernen.',
    },
    refs
  );
}

/** Questions that cannot be answered correctly, are empty or look odd. */
export function questionRules(ix: Index): Finding[] {
  const quizTitle = new Map(ix.snap.quizzes.map(z => [z.id, z.title]));
  const label = (q: { quizId: string; text: string }) =>
    `${quizTitle.get(q.quizId) ?? 'Quiz'}: ${q.text || '(ohne Text)'}`;
  const noCorrect: FindingRef[] = [];
  const fewOptions: FindingRef[] = [];
  const multiple: FindingRef[] = [];
  const emptyText: FindingRef[] = [];
  const emptyOption: FindingRef[] = [];
  const duplicate: FindingRef[] = [];
  const seen = new Map<string, number>();
  for (const q of ix.snap.questions) {
    const r = () => ref('question', q.id, label(q));
    if (q.text === '') emptyText.push(r());
    if (q.type === 'MCQ') {
      if (q.correctCount === 0) noCorrect.push(r());
      else if (q.correctCount > 1) multiple.push(r());
      if (q.optionCount < 2) fewOptions.push(r());
      if (q.emptyOptionCount > 0) emptyOption.push(r());
    }
    if (q.text !== '') {
      const key = `${q.quizId}|${normalizeTitle(q.text)}`;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      // The second and every later copy is named, the first one is the original
      if (count > 1) duplicate.push(r());
    }
  }
  return [
    ...group(
      {
        rule: 'question.correct.missing',
        severity: 'error',
        category: 'quiz',
        summary: n =>
          `${plural(n, 'Frage hat', 'Fragen haben')} keine richtige Antwort.`,
        hint: 'Die richtige Antwort markieren, sonst kann niemand die Frage richtig beantworten.',
      },
      noCorrect
    ),
    ...group(
      {
        rule: 'question.options.few',
        severity: 'warning',
        category: 'quiz',
        summary: n =>
          `${plural(n, 'Frage hat', 'Fragen haben')} weniger als zwei Antworten.`,
        hint: 'Antwortmöglichkeiten ergänzen.',
      },
      fewOptions
    ),
    ...group(
      {
        rule: 'question.correct.multiple',
        severity: 'info',
        category: 'quiz',
        summary: n =>
          `${plural(n, 'Frage hat', 'Fragen haben')} mehr als eine richtige Antwort.`,
        detail:
          'Bei Einfachauswahl ist das ein Hinweis, bei Mehrfachauswahl gewollt.',
        hint: 'Prüfen, ob nur eine Antwort richtig sein soll.',
      },
      multiple
    ),
    ...group(
      {
        rule: 'question.text.empty',
        severity: 'error',
        category: 'quiz',
        summary: n => `${plural(n, 'Frage hat', 'Fragen haben')} keinen Text.`,
        hint: 'Den Fragetext ergänzen oder die Frage löschen.',
      },
      emptyText
    ),
    ...group(
      {
        rule: 'question.option.empty',
        severity: 'error',
        category: 'quiz',
        summary: n =>
          `${plural(n, 'Frage hat', 'Fragen haben')} eine Antwort ohne Text.`,
        hint: 'Den Antworttext ergänzen oder die Antwort löschen.',
      },
      emptyOption
    ),
    ...group(
      {
        rule: 'question.duplicate',
        severity: 'warning',
        category: 'quiz',
        summary: n =>
          `${plural(n, 'Frage kommt', 'Fragen kommen')} im selben Quiz doppelt vor.`,
        detail: 'Genannt ist jeweils die zweite und jede weitere Kopie.',
        hint: 'Die doppelte Frage entfernen.',
      },
      duplicate
    ),
  ];
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Whether an enabler has a scenario, by the counting rule of the statistics
 * (src/lib/catalog/content-stats.ts): the old single PDF, a document of the
 * type EXERCISE, or a TRAINEE_QUESTION or TRAINER_SOLUTION titled
 * "Szenario <code>: ...".
 */
export function enablerHasScenario(
  enabler: SnapshotEnabler,
  docs: readonly SnapshotDocument[]
): boolean {
  if (enabler.hasScenarioPdf) return true;
  return docs.some(
    d =>
      d.type === 'EXERCISE' ||
      ((d.type === 'TRAINEE_QUESTION' || d.type === 'TRAINER_SOLUTION') &&
        enabler.code !== null &&
        d.title.startsWith(`Szenario ${enabler.code}: `))
  );
}

/** Enablers without a theory document and without a scenario. */
export function enablerDocuments(ix: Index): Finding[] {
  const noTheory: FindingRef[] = [];
  const noScenario: FindingRef[] = [];
  for (const e of ix.snap.enablers) {
    const docs = ix.docsOfEnabler.get(e.id) ?? [];
    if (!docs.some(d => d.type === 'THEORY')) {
      noTheory.push(ref('enabler', e.id, ix.enablerLabel(e)));
    }
    if (!enablerHasScenario(e, docs)) {
      noScenario.push(ref('enabler', e.id, ix.enablerLabel(e)));
    }
  }
  return [
    ...group(
      {
        rule: 'enabler.theory.missing',
        severity: 'warning',
        category: 'document',
        summary: n =>
          `${plural(n, 'Enabler hat', 'Enabler haben')} kein Theoriedokument.`,
        hint: 'Das Theoriedokument hochladen.',
      },
      noTheory
    ),
    ...group(
      {
        rule: 'enabler.scenario.missing',
        severity: 'warning',
        category: 'document',
        summary: n =>
          `${plural(n, 'Enabler hat', 'Enabler haben')} kein Szenario.`,
        detail: 'Gezählt wird wie in der Statistik oben.',
        hint: 'Das Szenario hochladen.',
      },
      noScenario
    ),
  ];
}

/** The part numbers ("Part 3", "Part 7a") in the titles of the scenario documents. */
export function scenarioPartNumbers(titles: readonly string[]): number[] {
  const numbers = new Set<number>();
  for (const title of titles) {
    const m = /\bPart\s*(\d+)/i.exec(title);
    if (m) numbers.add(Number(m[1]));
  }
  return [...numbers].sort((a, b) => a - b);
}

/** Scenario parts with a gap in the numbering (Part 1, 2, 4 ...). */
export function scenarioPartGaps(ix: Index): Finding[] {
  const refs: FindingRef[] = [];
  for (const e of ix.snap.enablers) {
    const titles = (ix.docsOfEnabler.get(e.id) ?? [])
      .filter(d => d.type === 'EXERCISE')
      .map(d => d.title);
    const numbers = scenarioPartNumbers(titles);
    if (numbers.length < 2) continue;
    const missing: number[] = [];
    for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n += 1) {
      if (!numbers.includes(n)) missing.push(n);
    }
    if (missing.length > 0) {
      refs.push(
        ref(
          'enabler',
          e.id,
          `${ix.enablerLabel(e)} (vorhanden: ${numbers.join(', ')}; fehlt: ${missing.join(', ')})`
        )
      );
    }
  }
  return group(
    {
      rule: 'scenario.part.gap',
      severity: 'warning',
      category: 'document',
      summary: n =>
        `${plural(n, 'Enabler hat', 'Enabler haben')} Szenario-Teile mit einer Lücke in der Nummerierung.`,
      hint: 'Den fehlenden Teil nachliefern oder die Nummerierung prüfen.',
    },
    refs
  );
}

/** Use cases without a task document or without a trainer solution. */
export function useCaseDocuments(ix: Index): Finding[] {
  const noTask: FindingRef[] = [];
  const noSolution: FindingRef[] = [];
  for (const u of ix.snap.useCases) {
    const docs = ix.docsOfUseCase.get(u.id) ?? [];
    if (!docs.some(d => d.type === 'TRAINEE_QUESTION')) {
      noTask.push(ref('useCase', u.id, ix.useCaseLabel(u)));
    }
    if (!docs.some(d => d.type === 'TRAINER_SOLUTION')) {
      noSolution.push(ref('useCase', u.id, ix.useCaseLabel(u)));
    }
  }
  return [
    ...group(
      {
        rule: 'usecase.task.missing',
        severity: 'warning',
        category: 'document',
        summary: n =>
          `${plural(n, 'Use Case hat', 'Use Cases haben')} kein Aufgabendokument für Azubis.`,
        hint: 'Die Aufgabe ohne Musterlösung hochladen.',
      },
      noTask
    ),
    ...group(
      {
        rule: 'usecase.solution.missing',
        severity: 'warning',
        category: 'document',
        summary: n =>
          `${plural(n, 'Use Case hat', 'Use Cases haben')} keine Trainerlösung.`,
        hint: 'Die Musterlösung hochladen.',
      },
      noSolution
    ),
  ];
}

/**
 * Documents with neither a stored file nor a text (the KfBM import keeps the
 * text of a scenario part in the description, without a file), and documents
 * with a file but no file name.
 */
export function documentWithoutFile(ix: Index): Finding[] {
  const refs = ix.snap.documents
    .filter(d => (!d.hasFile && !d.hasText) || d.fileName.trim() === '')
    .map(d => ref('document', d.id, d.title));
  return group(
    {
      rule: 'document.file.missing',
      severity: 'error',
      category: 'document',
      summary: n =>
        `${plural(n, 'Dokument hat', 'Dokumente haben')} weder Datei noch Text.`,
      hint: 'Die Datei erneut hochladen oder das Dokument löschen.',
    },
    refs
  );
}

/**
 * Documents of the same type with the same size and page count in different
 * enablers: a possible copy (for example a Vertiefung that repeats the base
 * course). Without a checksum this is a hint, not a proof.
 */
export function suspectedCopies(ix: Index): Finding[] {
  const bySignature = new Map<string, SnapshotDocument[]>();
  for (const d of ix.snap.documents) {
    if (!d.enablerId || d.useCaseId) continue;
    if (d.fileSize === null || d.fileSize < 1000 || d.pageCount === null) {
      continue;
    }
    push(bySignature, `${d.type}|${d.fileSize}|${d.pageCount}`, d);
  }
  const refs: FindingRef[] = [];
  for (const docs of bySignature.values()) {
    const enablers = new Set(docs.map(d => d.enablerId));
    if (enablers.size < 2) continue;
    for (const d of docs.slice(1)) {
      const e = d.enablerId ? ix.enablerById.get(d.enablerId) : undefined;
      refs.push(
        ref(
          'document',
          d.id,
          `${d.title} (${e ? ix.enablerLabel(e) : 'Enabler'})`
        )
      );
    }
  }
  return group(
    {
      rule: 'document.copy.suspected',
      severity: 'info',
      category: 'document',
      summary: n =>
        `${plural(n, 'Dokument hat', 'Dokumente haben')} dieselbe Größe und Seitenzahl wie ein Dokument eines anderen Enablers.`,
      detail:
        'Das ist ein Hinweis auf eine Kopie, kein Beweis (es gibt keine Prüfsumme).',
      hint: 'Prüfen, ob in beiden Enablern derselbe Inhalt liegt.',
    },
    refs
  );
}

// ---------------------------------------------------------------------------
// Titles and texts
// ---------------------------------------------------------------------------

interface Titled {
  id: string;
  type: FindingRefType;
  title: string;
  label: string;
  /** Titles are compared inside this group only (a course, an enabler). */
  scope: string;
  /** What the object is, for the duplicate rule. */
  kind: string;
}

function titledObjects(ix: Index): Titled[] {
  const { snap } = ix;
  const out: Titled[] = [];
  for (const c of snap.courses) {
    out.push({
      id: c.id,
      type: 'course',
      title: c.title,
      label: courseLabel(c),
      scope: 'catalog',
      kind: 'course',
    });
  }
  for (const e of snap.enablers) {
    out.push({
      id: e.id,
      type: 'enabler',
      title: e.title,
      label: ix.enablerLabel(e),
      scope: e.courseId,
      kind: 'enabler',
    });
  }
  for (const u of snap.useCases) {
    out.push({
      id: u.id,
      type: 'useCase',
      title: u.title,
      label: ix.useCaseLabel(u),
      scope: u.courseId,
      kind: 'useCase',
    });
  }
  for (const d of snap.documents) {
    out.push({
      id: d.id,
      type: 'document',
      title: d.title,
      label: d.title,
      scope: d.useCaseId ?? d.enablerId ?? d.courseId ?? 'none',
      kind: `document:${d.type}`,
    });
  }
  for (const z of snap.quizzes) {
    out.push({
      id: z.id,
      type: 'quiz',
      title: z.title,
      label: z.title,
      scope: z.enablerId ?? 'catalog',
      kind: `quiz:${z.type}:${z.difficulty ?? ''}`,
    });
  }
  for (const f of snap.learningFields) {
    out.push({
      id: f.id,
      type: 'learningField',
      title: f.title,
      label: `${f.code}: ${f.title}`,
      scope: 'catalog',
      kind: 'learningField',
    });
  }
  return out;
}

/** Empty titles, broken encoding, glued words, duplicates, description equal to title. */
export function titleRules(ix: Index): Finding[] {
  const objects = titledObjects(ix);
  const empty: FindingRef[] = [];
  const encoding: FindingRef[] = [];
  const glued: FindingRef[] = [];
  const duplicate: FindingRef[] = [];
  const seen = new Map<string, number>();
  for (const o of objects) {
    const r = () => ref(o.type, o.id, o.label);
    if (o.title.trim() === '') {
      empty.push(r());
      continue;
    }
    if (hasBrokenEncoding(o.title)) encoding.push(r());
    const words = gluedWords(o.title);
    if (words.length > 0) {
      glued.push(
        ref(o.type, o.id, `${words.slice(0, 2).join(', ')} in ${o.label}`)
      );
    }
    // Course titles repeat on purpose (a base course and its Vertiefung)
    if (o.kind === 'course') continue;
    const key = `${o.kind}|${o.scope}|${normalizeTitle(o.title)}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) duplicate.push(r());
  }
  const sameText: FindingRef[] = [];
  for (const e of ix.snap.enablers) {
    if (
      e.description &&
      normalizeTitle(e.description) === normalizeTitle(e.title) &&
      e.title.trim() !== ''
    ) {
      sameText.push(ref('enabler', e.id, ix.enablerLabel(e)));
    }
  }
  for (const u of ix.snap.useCases) {
    if (
      u.description &&
      normalizeTitle(u.description) === normalizeTitle(u.title) &&
      u.title.trim() !== ''
    ) {
      sameText.push(ref('useCase', u.id, ix.useCaseLabel(u)));
    }
  }
  return [
    ...group(
      {
        rule: 'title.empty',
        severity: 'error',
        category: 'text',
        summary: n => `${plural(n, 'Titel ist', 'Titel sind')} leer.`,
        hint: 'Einen Titel eintragen.',
      },
      empty
    ),
    ...group(
      {
        rule: 'title.encoding',
        severity: 'error',
        category: 'text',
        summary: n =>
          `${plural(n, 'Titel enthält', 'Titel enthalten')} kaputte Zeichen (Kodierungsfehler).`,
        hint: 'Den Titel neu schreiben, er stammt vermutlich aus einem fehlerhaften Import.',
      },
      encoding
    ),
    ...group(
      {
        rule: 'title.glued',
        severity: 'warning',
        category: 'text',
        summary: n =>
          `${plural(n, 'Titel enthält', 'Titel enthalten')} zusammengeklebte Wörter (Importrest).`,
        detail:
          'Ein Kleinbuchstabe direkt vor einem Großbuchstaben mitten im Wort. Eigennamen stehen auf einer Ausnahmeliste (title-rules.ts).',
        hint: 'Das Leerzeichen im Titel ergänzen.',
      },
      glued
    ),
    ...group(
      {
        rule: 'title.duplicate',
        severity: 'warning',
        category: 'text',
        summary: n =>
          `${plural(n, 'Titel kommt', 'Titel kommen')} im selben Zusammenhang doppelt vor.`,
        detail:
          'Verglichen wird je Art und Zusammenhang (Katalog, Kurs, Enabler). Genannt ist die zweite und jede weitere Kopie.',
        hint: 'Die Titel unterscheidbar machen oder das Duplikat entfernen.',
      },
      duplicate
    ),
    ...group(
      {
        rule: 'description.equalsTitle',
        severity: 'info',
        category: 'text',
        summary: n =>
          `${plural(n, 'Beschreibung ist', 'Beschreibungen sind')} gleich dem Titel.`,
        hint: 'Eine eigene Beschreibung schreiben.',
      },
      sameText
    ),
  ];
}

// ---------------------------------------------------------------------------
// Learning fields
// ---------------------------------------------------------------------------

/** Enablers and use cases without an assignment to a learning field (where assignments exist). */
export function learningFieldMapping(ix: Index): Finding[] {
  const { snap } = ix;
  // Without any assignment the catalog does not use learning fields for content
  if (snap.mappings.length === 0) return [];
  const mappedEnablers = new Set(
    snap.mappings.map(m => m.enablerId).filter((id): id is string => !!id)
  );
  const mappedUseCases = new Set(
    snap.mappings.map(m => m.useCaseId).filter((id): id is string => !!id)
  );
  const mappedFields = new Set(snap.mappings.map(m => m.learningFieldId));
  return [
    ...group(
      {
        rule: 'enabler.learningField.missing',
        severity: 'warning',
        category: 'structure',
        summary: n =>
          `${plural(n, 'Enabler ist', 'Enabler sind')} keinem Lernfeld zugeordnet.`,
        hint: 'Den Enabler einem Lernfeld zuordnen.',
      },
      snap.enablers
        .filter(e => !mappedEnablers.has(e.id))
        .map(e => ref('enabler', e.id, ix.enablerLabel(e)))
    ),
    ...group(
      {
        rule: 'usecase.learningField.missing',
        severity: 'warning',
        category: 'structure',
        summary: n =>
          `${plural(n, 'Use Case ist', 'Use Cases sind')} keinem Lernfeld zugeordnet.`,
        hint: 'Den Use Case einem Lernfeld zuordnen.',
      },
      snap.useCases
        .filter(u => !mappedUseCases.has(u.id))
        .map(u => ref('useCase', u.id, ix.useCaseLabel(u)))
    ),
    ...group(
      {
        rule: 'learningField.empty',
        severity: 'info',
        category: 'structure',
        summary: n =>
          `${plural(n, 'Lernfeld hat', 'Lernfelder haben')} keinen zugeordneten Inhalt.`,
        hint: 'Prüfen, ob Inhalt zu diesem Lernfeld fehlt.',
      },
      snap.learningFields
        .filter(f => !mappedFields.has(f.id))
        .map(f => ref('learningField', f.id, `${f.code}: ${f.title}`))
    ),
  ];
}

// ---------------------------------------------------------------------------
// Comparison with the plan (source 'plan')
// ---------------------------------------------------------------------------

const METRIC_NOUN: Record<ContentMetricId, string> = {
  components: 'Komponenten',
  enablers: 'Enabler',
  scenarios: 'Szenarien',
  useCases: 'Use Cases',
  lessonQuizzes: 'Enabler-Quizze',
  globalQuizzes: 'Global-Quizze',
  learningFields: 'Lernfelder',
};

/**
 * Actual numbers that differ from the targets of the catalog
 * (settings.content_targets). `stats` is the statistics of this catalog WITH
 * targets (buildCatalogStats(row, true)), so the counting rules are the ones of
 * the page, not a second copy.
 */
export function targetDeviations(stats: CatalogContentStats): Finding[] {
  const out: Finding[] = [];
  for (const id of CONTENT_METRICS) {
    const metric = stats.metrics.find(m => m.id === id);
    if (
      !metric ||
      metric.target === null ||
      metric.difference === null ||
      metric.status === 'met'
    ) {
      continue;
    }
    const missing = metric.difference < 0;
    out.push({
      rule: `plan.target.${id}`,
      severity: missing ? 'warning' : 'info',
      source: 'plan',
      category: 'plan',
      summary: missing
        ? `Es fehlen ${Math.abs(metric.difference)} ${METRIC_NOUN[id]} gegenüber dem Soll.`
        : `Es gibt ${metric.difference} ${METRIC_NOUN[id]} mehr als im Soll.`,
      details: `Ist ${metric.actual}, Soll ${metric.target}.`,
      refs: [ref('catalog', stats.catalogId, `${stats.code}: ${stats.title}`)],
      hint: missing
        ? 'Den fehlenden Inhalt nachliefern oder das Soll anpassen.'
        : 'Prüfen, ob das Soll noch stimmt.',
    });
  }
  return out;
}

/** Hours of the phase plan components that do not match their weeks (hours = weeks times 40). */
export function componentHours(ix: Index): Finding[] {
  const refs = ix.snap.components
    .filter(t => Math.abs(t.totalHours - t.totalWeeks * 40) > 0.5)
    .map(t =>
      ref(
        'catalog',
        t.id,
        `${t.code}: ${t.title} (${t.totalWeeks} Wochen, ${t.totalHours} Stunden)`
      )
    );
  return group(
    {
      rule: 'plan.hours.weeks',
      severity: 'warning',
      source: 'plan',
      category: 'plan',
      summary: n =>
        `${plural(n, 'Komponente hat', 'Komponenten haben')} Stunden, die nicht zu den Wochen passen.`,
      detail: 'Die Regel ist Stunden gleich Wochen mal 40.',
      hint: 'Wochen und Stunden im Phasenplan abgleichen.',
    },
    refs
  );
}

/**
 * Weeks of the compulsory components of each phase against the length of the
 * phase (settings.phase_months of the catalog, months times 52 / 12). More
 * weeks than the phase has is always reported. Fewer weeks is only reported when
 * the catalog has no elective components: the electives fill the rest (KfBM:
 * two of nine), so a gap is expected there.
 */
export function phaseHours(ix: Index): Finding[] {
  const { snap } = ix;
  const sum = snap.components.reduce((a, t) => a + t.totalWeeks, 0);
  if (sum === 0) return [];
  const plan = resolvePhasePlan(snap.catalog.settings, 3);
  const hasElectives = snap.components.some(t => t.kind === 'wahl');
  const out: Finding[] = [];
  plan.phaseMonths.forEach((months, i) => {
    const phase = i + 1;
    const members = snap.components.filter(
      t => t.phase === phase && t.kind === 'pflicht'
    );
    const weeks = members.reduce((a, t) => a + t.totalWeeks, 0);
    const hours = members.reduce((a, t) => a + t.totalHours, 0);
    const available = Math.round((months * 52) / 12);
    const over = weeks - available > PHASE_TOLERANCE_WEEKS;
    const under = available - weeks > PHASE_TOLERANCE_WEEKS && !hasElectives;
    if (!over && !under) return;
    out.push({
      rule: 'plan.hours.phase',
      severity: 'warning',
      source: 'plan',
      category: 'plan',
      summary: over
        ? `Phase ${phase}: Die Pflichtkomponenten haben ${weeks} Wochen, die Phase nur ${available} Wochen.`
        : `Phase ${phase}: Die Pflichtkomponenten haben nur ${weeks} Wochen, die Phase hat ${available} Wochen.`,
      details: `Pflichtkomponenten ${weeks} Wochen (${hours} Stunden), Phase ${months} Monate (${available} Wochen).`,
      refs: [
        ref(
          'catalog',
          snap.catalog.id,
          `${snap.catalog.code}: ${snap.catalog.title}`
        ),
      ],
      hint: 'Den Phasenplan der Komponenten und die Monate der Phase abgleichen.',
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// All rules
// ---------------------------------------------------------------------------

/** The rules in the order of the report. Each takes the index and returns findings. */
export const SCRIPT_RULES: readonly ((ix: Index) => Finding[])[] = [
  courseWithoutEnabler,
  catalogMismatch,
  componentWithoutCourse,
  useCaseLinks,
  orderIndexRules,
  inactiveCourseWithActiveEnablers,
  inactiveShare,
  enablerQuizzes,
  quizWithoutQuestions,
  questionRules,
  enablerDocuments,
  scenarioPartGaps,
  useCaseDocuments,
  documentWithoutFile,
  suspectedCopies,
  titleRules,
  learningFieldMapping,
  componentHours,
  phaseHours,
];

/**
 * All script rules over one snapshot, plus the comparison with the targets when
 * `stats` is given. Pure. The order of the findings is the order of the rules.
 */
export function runScriptRules(
  snapshot: ContentSnapshot,
  stats?: CatalogContentStats | null
): Finding[] {
  const ix = buildIndex(snapshot);
  const findings = SCRIPT_RULES.flatMap(rule => rule(ix));
  if (stats) findings.push(...targetDeviations(stats));
  return findings;
}

export { buildIndex };
