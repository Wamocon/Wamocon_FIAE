// The apply engine (phase 4.4). It compares the plan with the target database
// and, if asked, writes what is missing. It knows no SQL and no connection:
// the Db interface (db.ts) does that, and the caller owns the transaction.
//
// Guarantees:
//  - only the catalog KFBM is written, and only if the catalog exists and is
//    active in the target
//  - idempotent: a row is identified by a stable key (catalog + component
//    code, course + enabler code, catalog + quiz code, ...). A row that exists
//    is left as it is, a second run writes nothing
//  - nothing is deleted, nothing is overwritten. With updateExisting the named
//    columns of tables.ts are updated, nothing else
//  - a structural conflict (a key exists with another meaning, a quiz exists
//    with another number of questions) stops a writing run before the first
//    write (a comparison without write only reports it)
//  - solutions stay in their columns (guard.ts checks every row before it is
//    written)

import type { Db, Row } from './db';
import { ImportAbort } from './db';
import {
  findRowLeaks,
  leakOf,
  scenarioSolutionTexts,
  solutionTexts,
} from './guard';
import { validatePlan } from './plan';
import { TABLES, TABLE_ORDER } from './tables';
import type { TableName } from './tables';
import type {
  Conflict,
  Difference,
  ImportPlan,
  PlanQuiz,
  PlanScenario,
  QuizLevel,
  RunReport,
  TableCount,
} from './types';

export interface RunOptions {
  /** Profile entered as author of courses, quizzes and documents. */
  createdBy: string;
  /** Update the named columns of rows that exist and differ. */
  updateExisting: boolean;
  /** false = only compare, nothing is written. */
  write: boolean;
  /**
   * is_active (and is_published) of new courses, enablers and quizzes. Taken
   * from the decisions file by the caller, never from the plan file.
   */
  activate: boolean;
  /**
   * Also write the trainer-only parts of the scenarios (solution, knowledge
   * text). Off by default: the policy cd_select of content_documents lets the
   * public key read rows without an organization.
   */
  scenarioSolutions: boolean;
}

const DIFFICULTY: Record<QuizLevel, string> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
};

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** Updatable columns of the table in which the existing row differs from the desired one. */
function diffColumns(table: TableName, existing: Row, desired: Row): string[] {
  return TABLES[table].updatable.filter(column => {
    if (!(column in desired) || same(existing[column], desired[column])) {
      return false;
    }
    // A missing value in the plan never erases text that exists (a trainer may
    // have written it). Only an explanation is cleared where the plan has none,
    // so a rationale never stays on a wrong option.
    return !(
      (desired[column] ?? null) === null &&
      (existing[column] ?? null) !== null &&
      column !== 'explanation'
    );
  });
}

const baseName = (path: string) => path.split('/').pop() ?? path;

/** The three document rows of a scenario: the situation and two solution parts. */
export function scenarioDocuments(
  scenario: PlanScenario,
  enablerId: string,
  createdBy: string,
  withSolutions = true
): Row[] {
  const common = {
    enabler_id: enablerId,
    use_case_id: null,
    course_id: null,
    organization_id: null,
    file_name: baseName(scenario.source),
    file_size: null,
    // No file is stored yet: the row holds the text, the original document is
    // uploaded by a later step (storage_url stays empty until then, which the
    // HAI reindex skips).
    mime_type: 'text/plain',
    storage_url: '',
    storage_path: null,
    uploaded_by_id: createdBy,
  };
  const situation = {
    ...common,
    title: `Szenario ${scenario.enablerCode}: Ausgangssituation`,
    description: scenario.situation,
    document_type: 'TRAINEE_QUESTION',
    visibility: 'ALL',
    order_index: 1,
  };
  if (!withSolutions) return [situation];
  return [
    situation,
    {
      ...common,
      title: `Szenario ${scenario.enablerCode}: Lösung (Trainer)`,
      description: scenario.solution,
      document_type: 'TRAINER_SOLUTION',
      visibility: 'TRAINER_ONLY',
      order_index: 2,
    },
    {
      ...common,
      title: `Szenario ${scenario.enablerCode}: Fachwissen (Trainer)`,
      description: scenario.knowledgeContribution,
      document_type: 'TRAINER_SOLUTION',
      visibility: 'TRAINER_ONLY',
      order_index: 3,
    },
  ];
}

const emptyCounts = (): Record<string, TableCount> =>
  Object.fromEntries(
    TABLE_ORDER.map(name => [name, { insert: 0, update: 0, unchanged: 0 }])
  );

interface QuizItem {
  quiz: PlanQuiz;
  existing: Row | null;
  /** Existing questions in order, only for a quiz that exists. */
  existingQuestions: Row[];
  /** Existing options per question id, in order. */
  existingOptions: Map<string, Row[]>;
  /** The questions of an existing quiz are missing and are inserted. */
  fillQuestions: boolean;
}

/**
 * Compares the plan with the target and, with options.write, writes what is
 * missing. Returns the counts per table, the conflicts and the differences.
 * Throws ImportAbort before the first write if the plan or the target do not
 * fit.
 */
export async function executePlan(
  db: Db,
  plan: ImportPlan,
  options: RunOptions
): Promise<RunReport> {
  const problems = validatePlan(plan);
  if (problems.length > 0) {
    throw new ImportAbort(
      'PLAN_INVALID',
      `The plan is not valid (${problems.length} problem(s)): ${problems.slice(0, 5).join('; ')}`
    );
  }
  if (plan.catalog !== 'KFBM') {
    throw new ImportAbort(
      'CATALOG_REFUSED',
      'Only the catalog KFBM may be written.'
    );
  }
  const catalog = await db.findCatalog(plan.catalog);
  if (!catalog) {
    throw new ImportAbort(
      'CATALOG_MISSING',
      `The catalog ${plan.catalog} does not exist in the target database. Nothing was written.`
    );
  }
  if (!catalog.is_active) {
    throw new ImportAbort(
      'CATALOG_INACTIVE',
      `The catalog ${plan.catalog} is not active in the target database. Nothing was written.`
    );
  }
  const creator = await db.findProfile(options.createdBy);
  if (!creator) {
    throw new ImportAbort(
      'CREATOR_MISSING',
      'The profile named by --created-by does not exist in the target database.'
    );
  }
  if (
    !['SUPER_ADMIN', 'ADMIN', 'TEMP_ADMIN', 'TRAINER'].includes(creator.role)
  ) {
    throw new ImportAbort(
      'CREATOR_ROLE',
      'The profile named by --created-by must be a trainer or an admin.'
    );
  }
  const catalogId = catalog.id;
  const activate = options.activate;

  // State of the target, only the rows of this catalog ----------------------------
  const inCatalog = { training_catalog_id: catalogId };
  const compRows = await db.select('training_components', inCatalog);
  const courseRows = await db.select('courses', inCatalog);
  const enablerRows = await db.select('enablers', inCatalog);
  const quizRows = await db.select('quizzes', inCatalog);
  const quizIds = quizRows.map(r => String(r.id));
  const enablerIds = enablerRows.map(r => String(r.id));
  const questionRows = quizIds.length
    ? await db.select('questions', { quiz_id: quizIds })
    : [];
  const optionRows = questionRows.length
    ? await db.select('options', {
        question_id: questionRows.map(r => String(r.id)),
      })
    : [];
  const linkRows = new Map<string, Row>();
  if (enablerIds.length) {
    for (const row of await db.select('enabler_quiz_links', {
      enabler_id: enablerIds,
    })) {
      linkRows.set(String(row.id), row);
    }
  }
  if (quizIds.length) {
    for (const row of await db.select('enabler_quiz_links', {
      quiz_id: quizIds,
    })) {
      linkRows.set(String(row.id), row);
    }
  }
  const docRows = enablerIds.length
    ? await db.select('content_documents', { enabler_id: enablerIds })
    : [];

  const byCode = (rows: Row[]) =>
    new Map(rows.filter(r => r.code).map(r => [String(r.code), r]));
  const compByCode = byCode(compRows);
  const courseByCode = byCode(courseRows);
  const enablerByCode = byCode(enablerRows);
  const quizByCode = byCode(quizRows);

  const counts = emptyCounts();
  const conflicts: Conflict[] = [];
  const differences: Difference[] = [];
  const conflict = (table: string, key: string, reason: string) =>
    conflicts.push({ table, key, reason });
  const updates: Array<{ table: TableName; id: string; patch: Row }> = [];
  const noteExisting = (
    table: TableName,
    key: string,
    existing: Row,
    desired: Row
  ) => {
    const columns = diffColumns(table, existing, desired);
    if (columns.length === 0) {
      counts[table].unchanged += 1;
      return;
    }
    differences.push({ table, key, columns });
    if (options.updateExisting) {
      counts[table].update += 1;
      updates.push({
        table,
        id: String(existing.id),
        patch: Object.fromEntries(columns.map(c => [c, desired[c] ?? null])),
      });
    } else {
      counts[table].unchanged += 1;
    }
  };

  // Components ---------------------------------------------------------------------
  const newComponents = [] as typeof plan.components;
  for (const c of plan.components) {
    const existing = compByCode.get(c.code);
    if (!existing) {
      newComponents.push(c);
      counts.training_components.insert += 1;
      continue;
    }
    noteExisting('training_components', c.code, existing, {
      title: c.title,
      description: c.reference,
      phase: c.phase,
      kind: c.kind,
      order_index: c.orderIndex,
    });
  }

  // Courses ------------------------------------------------------------------------
  const newCourses = [] as typeof plan.components;
  for (const c of plan.components) {
    const existing = courseByCode.get(c.code);
    if (!existing) {
      newCourses.push(c);
      counts.courses.insert += 1;
      // A course of another code may already hold the component.
      const component = compByCode.get(c.code);
      const holder = component
        ? courseRows.find(r => r.training_component_id === component.id)
        : undefined;
      if (holder) {
        conflict(
          'courses',
          c.code,
          `The component ${c.code} is already linked to the course ${String(holder.code ?? holder.id)}`
        );
      }
      continue;
    }
    const component = compByCode.get(c.code);
    if (!component || existing.training_component_id !== component.id) {
      conflict(
        'courses',
        c.code,
        'The course exists but is not linked to the component of the same code'
      );
      continue;
    }
    noteExisting('courses', c.code, existing, {
      title: c.title,
      description: c.reference,
    });
  }

  // Enablers -----------------------------------------------------------------------
  const newEnablers = [] as typeof plan.enablers;
  for (const e of plan.enablers) {
    const existing = enablerByCode.get(e.code);
    if (!existing) {
      newEnablers.push(e);
      counts.enablers.insert += 1;
      continue;
    }
    const course = courseByCode.get(e.componentCode);
    if (!course || existing.course_id !== course.id) {
      conflict('enablers', e.code, 'The enabler code exists in another course');
      continue;
    }
    noteExisting('enablers', e.code, existing, {
      title: e.title,
      description_text: e.descriptionText,
      order_index: e.orderIndex,
    });
  }

  // Quizzes, questions and options ------------------------------------------------
  const questionsByQuiz = new Map<string, Row[]>();
  for (const row of questionRows) {
    const list = questionsByQuiz.get(String(row.quiz_id)) ?? [];
    list.push(row);
    questionsByQuiz.set(String(row.quiz_id), list);
  }
  const optionsByQuestion = new Map<string, Row[]>();
  for (const row of optionRows) {
    const list = optionsByQuestion.get(String(row.question_id)) ?? [];
    list.push(row);
    optionsByQuestion.set(String(row.question_id), list);
  }
  const byOrder = (a: Row, b: Row) =>
    Number(a.order_index ?? Number.MAX_SAFE_INTEGER) -
    Number(b.order_index ?? Number.MAX_SAFE_INTEGER);

  const quizItems: QuizItem[] = [];
  for (const quiz of plan.quizzes) {
    const existing = quizByCode.get(quiz.code) ?? null;
    const item: QuizItem = {
      quiz,
      existing,
      existingQuestions: [],
      existingOptions: new Map(),
      fillQuestions: false,
    };
    quizItems.push(item);
    const planQuestions = quiz.questions.length;
    if (!existing) {
      counts.quizzes.insert += 1;
      counts.questions.insert += planQuestions;
      counts.options.insert += quiz.questions.reduce(
        (n, q) => n + q.options.length,
        0
      );
      if (quiz.kind === 'global') {
        const component = compByCode.get(quiz.componentCode);
        const holder = component
          ? quizRows.find(
              r =>
                r.quiz_type === 'GLOBAL' &&
                r.training_component_id === component.id
            )
          : undefined;
        if (holder) {
          conflict(
            'quizzes',
            quiz.code,
            `The component ${quiz.componentCode} already has the global quiz ${String(holder.code ?? holder.id)}`
          );
        }
      }
      continue;
    }
    // The quiz exists: it must mean the same thing.
    const wantType = quiz.kind === 'global' ? 'GLOBAL' : 'LESSON';
    const component = compByCode.get(quiz.componentCode);
    const wantComponent =
      quiz.kind === 'global' ? (component?.id ?? null) : null;
    if (existing.quiz_type !== wantType) {
      conflict(
        'quizzes',
        quiz.code,
        `The quiz exists as ${String(existing.quiz_type)}, the plan says ${wantType}`
      );
      continue;
    }
    if ((existing.training_component_id ?? null) !== wantComponent) {
      conflict('quizzes', quiz.code, 'The quiz exists for another component');
      continue;
    }
    noteExisting('quizzes', quiz.code, existing, { title: quiz.title });

    const questions = [
      ...(questionsByQuiz.get(String(existing.id)) ?? []),
    ].sort(byOrder);
    item.existingQuestions = questions;
    if (questions.length === 0) {
      item.fillQuestions = true;
      counts.questions.insert += planQuestions;
      counts.options.insert += quiz.questions.reduce(
        (n, q) => n + q.options.length,
        0
      );
      continue;
    }
    if (questions.length !== planQuestions) {
      conflict(
        'quizzes',
        quiz.code,
        `The quiz has ${questions.length} questions in the database and ${planQuestions} in the plan. Deleting or re-creating questions is not part of this run.`
      );
      continue;
    }
    let shapeOk = true;
    quiz.questions.forEach((planned, index) => {
      if (!shapeOk) return;
      const row = questions[index];
      if (Number(row.order_index) !== planned.number) {
        shapeOk = false;
        return;
      }
      const options = [...(optionsByQuestion.get(String(row.id)) ?? [])].sort(
        byOrder
      );
      if (
        options.length !== planned.options.length ||
        options.some((o, i) => Number(o.order_index) !== i + 1)
      ) {
        shapeOk = false;
        return;
      }
      item.existingOptions.set(String(row.id), options);
    });
    if (!shapeOk) {
      conflict(
        'quizzes',
        quiz.code,
        'The questions or options of the quiz have another structure than the plan (numbers or option order differ).'
      );
      continue;
    }
    quiz.questions.forEach((planned, index) => {
      const row = questions[index];
      noteExisting('questions', `${quiz.code}#${planned.number}`, row, {
        question_text: planned.text,
      });
      const options = item.existingOptions.get(String(row.id)) as Row[];
      planned.options.forEach((option, i) => {
        noteExisting(
          'options',
          `${quiz.code}#${planned.number}${option.letter}`,
          options[i],
          {
            option_text: option.text,
            is_correct: option.isCorrect,
            explanation: option.explanation,
          }
        );
      });
    });
  }

  // Links between lesson quizzes and enablers --------------------------------------
  const linkList = [...linkRows.values()];
  const newLinks: Array<{
    enablerCode: string;
    quizCode: string;
    level: QuizLevel;
  }> = [];
  for (const item of quizItems) {
    const { quiz } = item;
    if (quiz.kind !== 'lesson' || !quiz.enablerCode || !quiz.level) continue;
    const enabler = enablerByCode.get(quiz.enablerCode);
    const difficulty = DIFFICULTY[quiz.level];
    const slot = enabler
      ? linkList.find(
          l => l.enabler_id === enabler.id && l.difficulty === difficulty
        )
      : undefined;
    const ofQuiz = item.existing
      ? linkList.find(l => l.quiz_id === item.existing?.id)
      : undefined;
    if (slot && item.existing && slot.quiz_id === item.existing.id) {
      counts.enabler_quiz_links.unchanged += 1;
    } else if (slot) {
      conflict(
        'enabler_quiz_links',
        `${quiz.enablerCode}/${difficulty}`,
        'The enabler already has another quiz for this level'
      );
    } else if (ofQuiz) {
      conflict(
        'enabler_quiz_links',
        quiz.code,
        'The quiz is already linked to another enabler or level'
      );
    } else {
      newLinks.push({
        enablerCode: quiz.enablerCode,
        quizCode: quiz.code,
        level: quiz.level,
      });
      counts.enabler_quiz_links.insert += 1;
    }
  }

  // Scenario documents -------------------------------------------------------------
  const docsByEnabler = new Map<string, Row[]>();
  for (const row of docRows) {
    const list = docsByEnabler.get(String(row.enabler_id)) ?? [];
    list.push(row);
    docsByEnabler.set(String(row.enabler_id), list);
  }
  const newDocs: Array<{ scenario: PlanScenario; rows: Row[] }> = [];
  for (const scenario of plan.scenarios) {
    const enabler = enablerByCode.get(scenario.enablerCode);
    const wanted = scenarioDocuments(
      scenario,
      String(enabler?.id ?? ''),
      options.createdBy,
      options.scenarioSolutions
    );
    if (!enabler) {
      counts.content_documents.insert += wanted.length;
      newDocs.push({ scenario, rows: wanted });
      continue;
    }
    const existingDocs = docsByEnabler.get(String(enabler.id)) ?? [];
    const missing: Row[] = [];
    for (const row of wanted) {
      const found = existingDocs.find(
        d => d.document_type === row.document_type && d.title === row.title
      );
      if (found && found.visibility !== row.visibility) {
        conflict(
          'content_documents',
          `${scenario.enablerCode}:${String(row.title)}`,
          'The document exists with another visibility than the plan'
        );
      } else if (found) {
        noteExisting(
          'content_documents',
          `${scenario.enablerCode}:${String(row.title)}`,
          found,
          row
        );
      } else {
        missing.push(row);
        counts.content_documents.insert += 1;
      }
    }
    if (missing.length > 0) newDocs.push({ scenario, rows: missing });
  }

  if (conflicts.length > 0 && options.write) {
    throw new ImportAbort(
      'CONFLICTS',
      `${conflicts.length} conflict(s) between the plan and the target database. Nothing was written.`,
      conflicts
    );
  }

  // Row builders (ids are known when a row is built) -------------------------------
  const componentRow = (c: (typeof plan.components)[number]): Row => ({
    training_catalog_id: catalogId,
    code: c.code,
    title: c.title,
    description: c.reference,
    total_weeks: c.totalWeeks,
    total_hours: c.totalHours,
    training_year: null,
    phase: c.phase,
    kind: c.kind,
    order_index: c.orderIndex,
  });
  const courseRow = (
    c: (typeof plan.components)[number],
    componentId: string
  ): Row => ({
    training_catalog_id: catalogId,
    code: c.code,
    training_component_id: componentId,
    title: c.title,
    description: c.reference,
    year: c.phase,
    chapter: c.orderIndex,
    exam_part: null,
    created_by_id: options.createdBy,
    is_active: activate,
    is_published: activate,
  });
  const enablerRow = (
    e: (typeof plan.enablers)[number],
    courseId: string
  ): Row => ({
    course_id: courseId,
    training_catalog_id: catalogId,
    code: e.code,
    title: e.title,
    order_index: e.orderIndex,
    description_text: e.descriptionText,
    is_active: activate,
  });
  const quizRow = (quiz: PlanQuiz, componentId: string | null): Row => ({
    code: quiz.code,
    title: quiz.title,
    quiz_type: quiz.kind === 'global' ? 'GLOBAL' : 'LESSON',
    created_by_id: options.createdBy,
    is_active: activate,
    training_catalog_id: catalogId,
    training_component_id: quiz.kind === 'global' ? componentId : null,
  });
  const questionRows2 = (quiz: PlanQuiz, quizId: string): Row[] =>
    quiz.questions.map(q => ({
      quiz_id: quizId,
      question_text: q.text,
      question_type: 'MCQ',
      expected_answer: null,
      order_index: q.number,
    }));
  const optionRows2 = (
    quiz: PlanQuiz,
    questionIds: Map<number, string>
  ): Row[] =>
    quiz.questions.flatMap(q =>
      q.options.map((o, i) => ({
        question_id: questionIds.get(q.number) as string,
        option_text: o.text,
        is_correct: o.isCorrect,
        explanation: o.explanation,
        order_index: i + 1,
      }))
    );

  // Solution protection on everything that is about to be written --------------------
  {
    const preview: Record<string, Row[]> = {
      training_components: newComponents.map(componentRow),
      courses: newCourses.map(c => courseRow(c, 'component')),
      enablers: newEnablers.map(e => enablerRow(e, 'course')),
      quizzes: quizItems
        .filter(i => !i.existing)
        .map(i => quizRow(i.quiz, 'component')),
      questions: quizItems
        .filter(i => !i.existing || i.fillQuestions)
        .flatMap(i => questionRows2(i.quiz, 'quiz')),
      options: quizItems
        .filter(i => !i.existing || i.fillQuestions)
        .flatMap(i =>
          optionRows2(
            i.quiz,
            new Map(i.quiz.questions.map(q => [q.number, 'question']))
          )
        ),
      content_documents: newDocs.flatMap(d => d.rows),
    };
    const leaks = findRowLeaks(
      preview,
      solutionTexts(plan),
      scenarioSolutionTexts(plan)
    );
    if (leaks.length > 0) {
      throw new ImportAbort(
        'SOLUTION_LEAK',
        `A solution would reach a visible field: ${leaks.slice(0, 3).join('; ')}. Nothing was written.`
      );
    }
  }

  // The values of updates are visible text as well
  {
    const solutions = solutionTexts(plan);
    const visibleColumns = [
      'title',
      'description',
      'description_text',
      'question_text',
      'option_text',
    ];
    for (const update of updates) {
      for (const column of visibleColumns) {
        const value = update.patch[column];
        if (typeof value === 'string' && leakOf(value, solutions)) {
          throw new ImportAbort(
            'SOLUTION_LEAK',
            `An update would put a solution into ${update.table}.${column}. Nothing was written.`
          );
        }
      }
    }
  }

  const report: RunReport = {
    catalog: plan.catalog,
    tables: counts,
    conflicts,
    differences,
    wrote: false,
  };
  if (!options.write) return report;

  // Write, parents first -------------------------------------------------------------
  const componentId = new Map<string, string>(
    [...compByCode].map(([code, row]) => [code, String(row.id)])
  );
  for (const row of await db.insert(
    'training_components',
    newComponents.map(componentRow)
  )) {
    componentId.set(String(row.code), String(row.id));
  }

  const courseId = new Map<string, string>(
    [...courseByCode].map(([code, row]) => [code, String(row.id)])
  );
  for (const row of await db.insert(
    'courses',
    newCourses.map(c => courseRow(c, componentId.get(c.code) as string))
  )) {
    courseId.set(String(row.code), String(row.id));
  }

  const enablerId = new Map<string, string>(
    [...enablerByCode].map(([code, row]) => [code, String(row.id)])
  );
  for (const row of await db.insert(
    'enablers',
    newEnablers.map(e => enablerRow(e, courseId.get(e.componentCode) as string))
  )) {
    enablerId.set(String(row.code), String(row.id));
  }

  const quizId = new Map<string, string>(
    [...quizByCode].map(([code, row]) => [code, String(row.id)])
  );
  const freshQuizzes = quizItems.filter(i => !i.existing);
  for (const row of await db.insert(
    'quizzes',
    freshQuizzes.map(i =>
      quizRow(i.quiz, componentId.get(i.quiz.componentCode) ?? null)
    )
  )) {
    quizId.set(String(row.code), String(row.id));
  }

  // Questions and options for new quizzes and for existing quizzes without questions
  const needQuestions = quizItems.filter(i => !i.existing || i.fillQuestions);
  const questionIdOf = new Map<string, Map<number, string>>();
  const insertedQuestions = await db.insert(
    'questions',
    needQuestions.flatMap(i =>
      questionRows2(i.quiz, quizId.get(i.quiz.code) as string)
    )
  );
  const codeOfQuiz = new Map([...quizId].map(([code, id]) => [id, code]));
  for (const row of insertedQuestions) {
    const code = codeOfQuiz.get(String(row.quiz_id)) as string;
    const map = questionIdOf.get(code) ?? new Map<number, string>();
    map.set(Number(row.order_index), String(row.id));
    questionIdOf.set(code, map);
  }
  await db.insert(
    'options',
    needQuestions.flatMap(i =>
      optionRows2(i.quiz, questionIdOf.get(i.quiz.code) as Map<number, string>)
    )
  );

  await db.insert(
    'enabler_quiz_links',
    newLinks.map(l => ({
      enabler_id: enablerId.get(l.enablerCode) as string,
      quiz_id: quizId.get(l.quizCode) as string,
      difficulty: DIFFICULTY[l.level],
    }))
  );

  await db.insert(
    'content_documents',
    newDocs.flatMap(({ scenario, rows }) =>
      rows.map(row => ({
        ...row,
        enabler_id: enablerId.get(scenario.enablerCode) as string,
      }))
    )
  );

  for (const update of updates) {
    await db.update(update.table, update.id, update.patch);
  }
  report.wrote = true;
  return report;
}
