// Numbers and ids of a quiz JSON reading, for the tool check-quizzes. Pure
// functions. The report names counts, component codes, quiz ids and the codes of
// the findings. It never holds a text of the file.

import type { QuizLevel } from '../apply/types';
import type { QuizJsonFinding, QuizJsonRead } from './types';

export interface QuizJsonSummary {
  lesson: SideSummary;
  global: SideSummary;
}

export interface SideSummary {
  /** The file was named on the command line. */
  given: boolean;
  /** The file was read (false: the structure was refused, see findings). */
  read: boolean;
  quizzes: number;
  sets: number;
  questions: number;
  /** Sets by level (lesson quizzes only). */
  byLevel: Record<QuizLevel, number>;
  /** Component code to numbers. */
  byComponent: Array<{
    component: string;
    quizzes: number;
    sets: number;
    questions: number;
  }>;
  /** Number of questions to the ids of the sets that have this many. */
  byQuestionCount: Array<{ questions: number; sets: number; ids: string[] }>;
  /** Sets that carry at least one error (they would be skipped). */
  setsWithErrors: number;
  /** Code and severity to the number of findings and the ids they name. */
  findings: Array<{
    severity: 'error' | 'warning';
    code: string;
    count: number;
    ids: string[];
  }>;
}

const MAX_IDS = 40;

const setLabel = (id: string, level: QuizLevel | null) =>
  level ? `${id}/${level}` : id;

function codeOrder(a: string, b: string): number {
  const parse = (code: string) => {
    const m = /^K(\d+)(?:\.(\d))?$/.exec(code);
    return m ? Number(m[1]) * 10 + Number(m[2] ?? 0) : Number.MAX_SAFE_INTEGER;
  };
  return parse(a) - parse(b) || a.localeCompare(b);
}

function summarizeSide(read: QuizJsonRead | null): SideSummary {
  const empty: SideSummary = {
    given: false,
    read: false,
    quizzes: 0,
    sets: 0,
    questions: 0,
    byLevel: { low: 0, medium: 0, high: 0 },
    byComponent: [],
    byQuestionCount: [],
    setsWithErrors: 0,
    findings: [],
  };
  if (!read) return empty;
  const byComponent = new Map<
    string,
    { quizzes: Set<string>; sets: number; questions: number }
  >();
  const byCount = new Map<number, string[]>();
  const byLevel: Record<QuizLevel, number> = { low: 0, medium: 0, high: 0 };
  let questions = 0;
  let setsWithErrors = 0;
  for (const set of read.sets) {
    questions += set.questions;
    if (set.errors > 0) setsWithErrors += 1;
    if (set.level) byLevel[set.level] += 1;
    const code = set.componentCode ?? 'unbekannt';
    const row = byComponent.get(code) ?? {
      quizzes: new Set<string>(),
      sets: 0,
      questions: 0,
    };
    row.quizzes.add(set.id);
    row.sets += 1;
    row.questions += set.questions;
    byComponent.set(code, row);
    byCount.set(set.questions, [
      ...(byCount.get(set.questions) ?? []),
      setLabel(set.id, set.level),
    ]);
  }
  const grouped = new Map<
    string,
    { severity: 'error' | 'warning'; code: string; ids: string[] }
  >();
  for (const f of read.findings) {
    const key = `${f.severity}:${f.code}`;
    const row = grouped.get(key) ?? {
      severity: f.severity,
      code: f.code,
      ids: [],
    };
    row.ids.push(findingLabel(f));
    grouped.set(key, row);
  }
  return {
    given: true,
    read: !read.fatal,
    quizzes: read.quizzes,
    sets: read.sets.length,
    questions,
    byLevel,
    byComponent: [...byComponent]
      .sort(([a], [b]) => codeOrder(a, b))
      .map(([component, row]) => ({
        component,
        quizzes: row.quizzes.size,
        sets: row.sets,
        questions: row.questions,
      })),
    byQuestionCount: [...byCount]
      .sort(([a], [b]) => a - b)
      .map(([count, ids]) => ({
        questions: count,
        sets: ids.length,
        ids: ids.slice(0, MAX_IDS),
      })),
    setsWithErrors,
    findings: [...grouped.values()]
      .sort(
        (a, b) =>
          (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) ||
          a.code.localeCompare(b.code)
      )
      .map(row => ({
        severity: row.severity,
        code: row.code,
        count: row.ids.length,
        ids: [...new Set(row.ids)].slice(0, MAX_IDS),
      })),
  };
}

function findingLabel(f: QuizJsonFinding): string {
  if (f.id === null)
    return f.entry === null ? '(Datei)' : `(Eintrag ${f.entry})`;
  const base = setLabel(f.id, f.level);
  return f.question === null ? base : `${base}#${f.question}`;
}

export function summarizeQuizJson(
  lesson: QuizJsonRead | null,
  global: QuizJsonRead | null
): QuizJsonSummary {
  return { lesson: summarizeSide(lesson), global: summarizeSide(global) };
}

const more = (ids: string[], count: number) =>
  ids.join(', ') + (count > ids.length ? ' und weitere' : '');

function renderSide(
  title: string,
  side: SideSummary,
  out: string[],
  levels: boolean
) {
  out.push(`## ${title}`);
  out.push('');
  if (!side.given) {
    out.push('Nicht angegeben.');
    out.push('');
    return;
  }
  if (!side.read) {
    out.push(
      'Die Datei wurde nicht gelesen (Aufbau abgelehnt, siehe Befunde).'
    );
  } else {
    out.push(
      `Quizze: ${side.quizzes}, Sätze: ${side.sets}, Fragen: ${side.questions}, Sätze mit Fehler: ${side.setsWithErrors}.`
    );
    if (levels) {
      out.push(
        `Stufen: leicht ${side.byLevel.low}, mittel ${side.byLevel.medium}, schwer ${side.byLevel.high}.`
      );
    }
    out.push('');
    out.push('| Komponente | Quizze | Sätze | Fragen |');
    out.push('|---|---|---|---|');
    for (const row of side.byComponent) {
      out.push(
        `| ${row.component} | ${row.quizzes} | ${row.sets} | ${row.questions} |`
      );
    }
    out.push('');
    out.push('| Fragen je Satz | Sätze | Kennungen |');
    out.push('|---|---|---|');
    for (const row of side.byQuestionCount) {
      out.push(
        `| ${row.questions} | ${row.sets} | ${more(row.ids, row.sets)} |`
      );
    }
  }
  out.push('');
  out.push('Befunde:');
  out.push('');
  if (side.findings.length === 0) {
    out.push('Keine.');
  } else {
    out.push('| Art | Code | Anzahl | Kennungen |');
    out.push('|---|---|---|---|');
    for (const f of side.findings) {
      out.push(
        `| ${f.severity === 'error' ? 'Fehler' : 'Hinweis'} | ${f.code} | ${f.count} | ${more(f.ids, f.count)} |`
      );
    }
  }
  out.push('');
}

/** German Markdown with numbers and ids only. */
export function renderQuizJsonReport(summary: QuizJsonSummary): string {
  const out: string[] = ['# Prüfung der Quiz-JSON-Dateien', ''];
  out.push(
    'Der Bericht nennt Zahlen, Komponenten, Kennungen und Codes, keine Inhalte der Dateien.'
  );
  out.push('');
  renderSide('Enabler-Quizze', summary.lesson, out, true);
  renderSide('Global-Quizze', summary.global, out, false);
  return out.join('\n');
}
