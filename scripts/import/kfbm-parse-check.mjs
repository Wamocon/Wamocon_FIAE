// Dry run of the KfBM parsers over the source folder (phase 4.3, read only).
//
// Reads the available .docx files one after the other (never several at once),
// runs the quiz, scenario and use case parsers (and a metadata check for the
// long enabler texts) and reports per file success or the list of deviations from the
// expected format, plus a summary: it shows whether the sources really are
// uniform. OneDrive placeholders (files that are not downloaded yet) are
// skipped and counted, run the check again later.
//
// Read only: nothing is written to a database, nothing is sent over the
// network, the source files are never changed or copied. The report holds
// counts, paths and messages. It stores no question texts, answers or
// rationales. Only the message about a line that fits no part of the format
// quotes up to 60 characters of that line, to find it.
//
// Usage:
//   node scripts/import/kfbm-parse-check.mjs <source folder> [--out <file.json>]
//        [--only quiz,scenario,use-case,global-quiz,enabler] [--limit <n>]
//        [--expected-questions <n>] [--include-k18] [--no-attributes]
//        [--hydrate] [--timeout <seconds>]
// --hydrate also reads the OneDrive placeholders (each file is downloaded on its
// first read, sequentially, with a timeout per file). Without it they are
// skipped and counted.
// With --out the JSON goes to that file and a summary in Markdown next to it
// (same name, .md). Without --out the summary is printed.

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  enablerKeysMatch,
  extractDocxParagraphs,
  extractDocxStats,
  pathInfo,
  parseQuizText,
  parseScenarioText,
  parseUseCaseText,
  readAttributes,
  walkSource,
} from './kfbm-source.mjs';

/** Questions of a global quiz (1 to 5 easy, 6 to 15 medium, 16 to 20 hard). */
export const GLOBAL_QUIZ_QUESTIONS = 20;
const PARSED_TYPES = ['quiz', 'scenario', 'use-case', 'global-quiz', 'enabler'];

const issue = (code, message, severity = 'error') => ({
  code,
  severity,
  message,
});

/**
 * Checks one document against the format. `content` is {paragraphs} for quiz,
 * scenario, use case and global quiz, {stats, size} for an enabler text.
 * @param {string} rel
 * @param {ReturnType<typeof pathInfo>} info
 * @param {{ paragraphs?: any[], stats?: any, size?: number }} content
 * @param {{ expectedQuestions?: number }} [options]
 */
export function checkParsed(rel, info, content, options = {}) {
  const result = { rel, type: info.type, status: 'ok', issues: [], stats: {} };

  if (info.type === 'enabler') {
    const stats = content.stats;
    result.stats = {
      ...stats,
      ...(content.size !== undefined ? { size: content.size } : {}),
    };
    if (!stats.heading || stats.characters === 0) {
      result.issues.push(
        issue('ENABLER_EMPTY', 'The enabler text has no heading or no text.')
      );
    }
  } else if (info.type === 'quiz' || info.type === 'global-quiz') {
    const isGlobal = info.type === 'global-quiz';
    const parsed = parseQuizText(content.paragraphs, {
      expectedQuestions: isGlobal
        ? GLOBAL_QUIZ_QUESTIONS
        : options.expectedQuestions,
    });
    result.issues.push(...parsed.issues);
    const quiz = parsed.value;
    result.stats = {
      questions: quiz.questions.length,
      difficulty: quiz.difficulty,
      code: isGlobal ? quiz.componentKey : quiz.enablerCode,
    };
    if (isGlobal) {
      if (quiz.kind !== 'global') {
        result.issues.push(
          issue(
            'KIND_MISMATCH',
            'The file is in the place of a global quiz but is not one.'
          )
        );
      } else if (
        quiz.componentKey &&
        info.component &&
        quiz.componentKey !== info.component.key
      ) {
        result.issues.push(
          issue(
            'CODE_MISMATCH',
            `The heading names component ${quiz.componentKey}, the path component ${info.component.key}.`
          )
        );
      }
    } else {
      if (quiz.kind === 'global') {
        result.issues.push(
          issue(
            'KIND_MISMATCH',
            'The file is in the place of an enabler quiz but is a global quiz.'
          )
        );
      }
      if (
        quiz.difficulty &&
        info.difficulty &&
        quiz.difficulty !== info.difficulty
      ) {
        result.issues.push(
          issue(
            'DIFFICULTY_MISMATCH',
            `The heading says ${quiz.difficulty}, the file name ${info.difficulty}.`
          )
        );
      }
      if (
        quiz.enablerCode &&
        info.enablerKey &&
        !enablerKeysMatch(quiz.enablerCode, info.enablerKey)
      ) {
        result.issues.push(
          issue(
            'CODE_MISMATCH',
            `The heading names enabler ${quiz.enablerCode}, the path enabler ${info.enablerKey}.`
          )
        );
      }
    }
  } else if (info.type === 'scenario') {
    const parsed = parseScenarioText(content.paragraphs);
    result.issues.push(...parsed.issues);
    result.stats = {
      code: parsed.value.code,
      situationCharacters: parsed.value.situation.length,
      taskCharacters: parsed.value.task.length,
    };
    if (
      parsed.value.code &&
      info.enablerKey &&
      !enablerKeysMatch(parsed.value.code, info.enablerKey)
    ) {
      result.issues.push(
        issue(
          'CODE_MISMATCH',
          `The heading names scenario ${parsed.value.code}, the path enabler ${info.enablerKey}.`
        )
      );
    }
  } else if (info.type === 'use-case') {
    const parsed = parseUseCaseText(content.paragraphs);
    result.issues.push(...parsed.issues);
    result.stats = {
      code: parsed.value.code,
      situationCharacters: parsed.value.situation.length,
      solutionCharacters: parsed.value.solution.length,
    };
    if (
      parsed.value.code &&
      info.enablerKey &&
      !enablerKeysMatch(parsed.value.code, info.enablerKey)
    ) {
      result.issues.push(
        issue(
          'CODE_MISMATCH',
          `The heading names use case ${parsed.value.code}, the path enabler ${info.enablerKey}.`
        )
      );
    }
    if (info.flags.includes('without-solution')) {
      result.issues.push(
        issue(
          'FOLDER_WITHOUT_SOLUTION',
          'The file lies in a folder "Ohne Musterlösung".',
          'warning'
        )
      );
    }
  }

  if (result.issues.some(i => i.severity === 'error')) result.status = 'error';
  else if (result.issues.length > 0) result.status = 'warning';
  return result;
}

class TimeoutError extends Error {}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new TimeoutError(
            `Timeout after ${ms} ms while reading the file (download from OneDrive stuck?).`
          )
        ),
      ms
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Reads the available documents one after the other and checks them.
 * @param {string} root source folder
 * @param {Array<{rel: string, size: number, placeholder: boolean}>} entries
 * With hydrate the placeholders are read too, one after the other (OneDrive
 * downloads each file on first read). A read that takes longer than timeoutMs
 * ends as a read error, three in a row stop the run.
 * @param {{ only?: string[], limit?: number, includeExcluded?: boolean, expectedQuestions?: number, hydrate?: boolean, timeoutMs?: number, readFile?: (file: string) => Promise<Buffer>, onProgress?: (done: number, total: number) => void }} [options]
 */
export async function runCheck(root, entries, options = {}) {
  const {
    only = null,
    limit = Infinity,
    includeExcluded = false,
    hydrate = false,
    timeoutMs = 60000,
    readFile: read = readFile,
  } = options;
  const skipped = {
    placeholders: [],
    excluded: 0,
    archive: 0,
    filtered: 0,
    notParsed: {},
  };
  const todo = [];
  for (const entry of entries) {
    const info = pathInfo(entry.rel);
    if (info.type === 'archive') {
      skipped.archive += 1;
    } else if (info.component?.excluded && !includeExcluded) {
      skipped.excluded += 1;
    } else if (
      !PARSED_TYPES.includes(info.type) ||
      !/^docx$/.test(info.format)
    ) {
      skipped.notParsed[info.type] = (skipped.notParsed[info.type] ?? 0) + 1;
    } else if (only && !only.includes(info.type)) {
      skipped.filtered += 1;
    } else if (entry.placeholder && !hydrate) {
      skipped.placeholders.push(entry.rel);
    } else {
      todo.push({ entry, info });
    }
  }

  const results = [];
  let timeoutsInARow = 0;
  let aborted = false;
  for (const { entry, info } of todo.slice(0, limit)) {
    try {
      const buffer = await withTimeout(
        read(path.join(root, ...entry.rel.split('/'))),
        timeoutMs
      );
      timeoutsInARow = 0;
      const content =
        info.type === 'enabler'
          ? { stats: await extractDocxStats(buffer), size: entry.size }
          : { paragraphs: await extractDocxParagraphs(buffer) };
      const result = checkParsed(entry.rel, info, content, options);
      if (entry.placeholder) result.hydrated = true;
      results.push(result);
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      timeoutsInARow = timedOut ? timeoutsInARow + 1 : 0;
      results.push({
        rel: entry.rel,
        type: info.type,
        status: 'read-error',
        issues: [
          issue(
            'READ_ERROR',
            error instanceof Error ? error.message : String(error)
          ),
        ],
        stats: {},
      });
      if (timeoutsInARow >= 3) {
        aborted = true;
        break;
      }
    }
    options.onProgress?.(results.length, Math.min(todo.length, limit));
  }
  return { results, skipped, aborted };
}

/** Aggregates the results of a run. */
export function summarize(run) {
  const { results, skipped } = run;
  const files = {
    processed: results.length,
    ok: results.filter(r => r.status === 'ok').length,
    withIssues: results.filter(r => r.status !== 'ok').length,
    withErrors: results.filter(
      r => r.status === 'error' || r.status === 'read-error'
    ).length,
    readErrors: results.filter(r => r.status === 'read-error').length,
    placeholders: skipped.placeholders.length,
    hydrated: results.filter(r => r.hydrated).length,
    excluded: skipped.excluded,
    archive: skipped.archive,
  };
  const byType = {};
  const questionCounts = {};
  let questions = 0;
  const deviations = new Map();
  for (const r of results) {
    byType[r.type] ??= { processed: 0, ok: 0, withIssues: 0 };
    byType[r.type].processed += 1;
    byType[r.type][r.status === 'ok' ? 'ok' : 'withIssues'] += 1;
    if (typeof r.stats?.questions === 'number') {
      questions += r.stats.questions;
      questionCounts[r.type] ??= {};
      questionCounts[r.type][r.stats.questions] =
        (questionCounts[r.type][r.stats.questions] ?? 0) + 1;
    }
    const seen = new Set();
    for (const i of r.issues) {
      const entry = deviations.get(i.code) ?? {
        code: i.code,
        severity: i.severity,
        files: 0,
        occurrences: 0,
        example: { rel: r.rel, message: i.message },
      };
      entry.occurrences += 1;
      if (!seen.has(i.code)) {
        entry.files += 1;
        seen.add(i.code);
      }
      if (i.severity === 'error') entry.severity = 'error';
      deviations.set(i.code, entry);
    }
  }
  return {
    aborted: Boolean(run.aborted),
    files,
    byType,
    questions,
    questionCounts,
    deviations: [...deviations.values()].sort(
      (a, b) => b.files - a.files || a.code.localeCompare(b.code)
    ),
    skipped: {
      placeholders: skipped.placeholders,
      notParsed: skipped.notParsed,
      filtered: skipped.filtered,
    },
  };
}

const cell = text =>
  String(text ?? '')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ');

/** Short summary in Markdown (German). */
export function renderCheckSummary(
  summary,
  { root = null, generatedAt = null } = {}
) {
  const out = [];
  const f = summary.files;
  out.push('# Prüflauf der KfBM-Parser (Trockenlauf)');
  out.push('');
  if (root) out.push(`Quelle: \`${root}\``);
  if (generatedAt) out.push(`Stand: ${generatedAt}`);
  out.push(
    'Nur gelesen. Keine Datenbank, kein Netzwerk, keine Quelldatei verändert. Der Bericht speichert keine Fragetexte, Antworten oder Begründungen. Nur die Meldung zu einer nicht zuordenbaren Zeile zitiert bis zu 60 Zeichen dieser Zeile.'
  );
  out.push('');
  if (summary.aborted) {
    out.push(
      '**Der Lauf wurde abgebrochen:** drei Dateien nacheinander ließen sich nicht in der Zeit laden. OneDrive prüfen und den Lauf wiederholen.'
    );
    out.push('');
  }
  out.push('## Ergebnis');
  out.push('');
  out.push('| Größe | Anzahl |');
  out.push('|---|---|');
  out.push(`| Dateien geprüft | ${f.processed} |`);
  out.push(`| ohne Abweichung | ${f.ok} |`);
  out.push(`| mit Abweichung (Fehler oder Hinweis) | ${f.withIssues} |`);
  out.push(`| davon mit Fehler | ${f.withErrors} |`);
  out.push(`| nicht lesbar | ${f.readErrors} |`);
  out.push(`| Fragen insgesamt (gelesen) | ${summary.questions} |`);
  out.push(
    `| Platzhalter beim Lesen geladen (OneDrive) | ${f.hydrated} |`,
    `| Platzhalter übersprungen (noch nicht geladen) | ${f.placeholders} |`
  );
  out.push(`| K18 übersprungen | ${f.excluded} |`);
  out.push(`| Archivdateien übersprungen | ${f.archive} |`);
  out.push('');
  out.push('Je Dateityp:');
  out.push('');
  out.push('| Typ | geprüft | ohne Abweichung | mit Abweichung |');
  out.push('|---|---|---|---|');
  for (const [type, row] of Object.entries(summary.byType)) {
    out.push(`| ${type} | ${row.processed} | ${row.ok} | ${row.withIssues} |`);
  }
  out.push('');
  out.push('## Formatabweichungen');
  out.push('');
  if (summary.deviations.length === 0) {
    out.push(
      'Keine. Alle geprüften Dateien entsprechen dem erwarteten Format.'
    );
  } else {
    out.push(
      '| Abweichung | Art | Dateien | Vorkommen | Beispielpfad | Meldung |'
    );
    out.push('|---|---|---|---|---|---|');
    for (const d of summary.deviations) {
      out.push(
        `| ${d.code} | ${d.severity === 'error' ? 'Fehler' : 'Hinweis'} | ${d.files} | ${d.occurrences} | \`${cell(d.example.rel)}\` | ${cell(d.example.message)} |`
      );
    }
  }
  out.push('');
  out.push('## Fragen je Datei');
  out.push('');
  const types = Object.keys(summary.questionCounts);
  if (types.length === 0) {
    out.push('Noch keine Quiz-Datei gelesen.');
  } else {
    for (const type of types) {
      const dist = Object.entries(summary.questionCounts[type])
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([count, files]) => `${count} Fragen: ${files} Dateien`)
        .join(', ');
      out.push(`- ${type}: ${dist}`);
    }
  }
  out.push('');
  if (f.placeholders > 0) {
    out.push('## Noch Platzhalter');
    out.push('');
    out.push(
      `${f.placeholders} Dateien waren noch nicht heruntergeladen und wurden übersprungen. Den Lauf später wiederholen.`
    );
    out.push('');
  }
  return out.join('\n');
}

function positional(argv) {
  const withValue = new Set([
    '--out',
    '--only',
    '--limit',
    '--expected-questions',
    '--timeout',
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    if (withValue.has(argv[i])) i += 1;
    else if (!argv[i].startsWith('--')) return argv[i];
  }
  return undefined;
}
const argValue = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function main() {
  const argv = process.argv.slice(2);
  const root = positional(argv);
  if (!root) {
    console.error(
      'Usage: node scripts/import/kfbm-parse-check.mjs <source folder> [--out <file.json>] [--only quiz,scenario,use-case,global-quiz,enabler] [--limit <n>] [--expected-questions <n>] [--include-k18] [--no-attributes] [--hydrate] [--timeout <seconds>]'
    );
    process.exit(2);
  }
  let stat;
  try {
    stat = statSync(root);
  } catch {
    stat = null;
  }
  if (!stat?.isDirectory()) {
    console.error(`${root} is not a folder or does not exist.`);
    process.exit(2);
  }
  const attributes = argv.includes('--no-attributes')
    ? null
    : readAttributes(root);
  if (!attributes && !argv.includes('--no-attributes')) {
    console.error(
      'File attributes are not available, placeholders cannot be told apart.'
    );
  }
  const entries = walkSource(root, { attributes });
  const only = argValue(argv, '--only')
    ?.split(',')
    .map(s => s.trim());
  const limit = argValue(argv, '--limit');
  const expected = argValue(argv, '--expected-questions');
  const run = await runCheck(root, entries, {
    only,
    limit: limit ? Number(limit) : Infinity,
    includeExcluded: argv.includes('--include-k18'),
    hydrate: argv.includes('--hydrate'),
    timeoutMs: argValue(argv, '--timeout')
      ? Number(argValue(argv, '--timeout')) * 1000
      : undefined,
    expectedQuestions: expected ? Number(expected) : undefined,
    onProgress: (done, total) => {
      if (done % 100 === 0) console.error(`${done} of ${total} files checked`);
    },
  });
  const summary = summarize(run);
  const report = {
    root: path.resolve(root),
    generatedAt: new Date().toISOString(),
    summary,
    results: run.results.filter(r => r.status !== 'ok'),
    okFiles: run.results.filter(r => r.status === 'ok').map(r => r.rel),
  };
  const md = renderCheckSummary(summary, {
    root: report.root,
    generatedAt: report.generatedAt,
  });
  const out = argValue(argv, '--out');
  if (out) {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    const mdPath = out.replace(/\.json$/i, '') + '.md';
    writeFileSync(mdPath, md, 'utf8');
    console.log(`Parse check written: ${out} and ${mdPath}`);
  } else {
    console.log(md);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
  // A read that never finished must not keep the process alive.
  process.exit(0);
}
