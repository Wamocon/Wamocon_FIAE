// Golden set measurement of the rule stage of the content upload (package U8 of
// docs/ki-upload-konzept.md, section 10.1). Command line tool outside of Next.
//
// What it does: reads the Word and PDF files of the source folder one after the
// other (read only, never copied, never changed), classifies every file with the
// rule stage of the upload (assignFile) and compares the result with the truth
// that pathInfo() derives from the full original path. Two modes:
//
//   path   the full relative path counts (the folder tree of the source)
//   names  only the file name counts (files without a tree, the loose collection)
//
// It prints numbers only: counts, shares, times and the content keys of the
// known special cases (for example scenario:23c). No path, no title, no text of
// a document. The cache of read files is not kept: every run reads the source
// again, so nothing of the content ever lies on disk next to the repository.
//
// Gate: the run exits with 1 when the share of files that the rules resolve
// correctly without the model is below --min-ratio (default 92, the target of
// the concept) or when a file with the band high is wrong (hard criterion).
// Exit 2: wrong call or too many files that could not be read.
//
// Usage:
//   node scripts/import/kfbm-golden-set.mjs <source folder> [--mode path,names]
//        [--min-ratio <percent>] [--hydrate] [--timeout <seconds>]
//        [--limit <n>] [--include-k18] [--show-keys] [--out <file.json>]
// --hydrate also reads OneDrive placeholders (downloaded on the first read, one
// after the other, with a timeout per file). Without it they are skipped and
// counted.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pathInfo, readAttributes, walkSource } from './kfbm-source.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const tsModule = relative =>
  import(pathToFileURL(path.join(ROOT, relative)).href);
const [classify, upload, decisionModule] = await Promise.all([
  tsModule('src/lib/content-upload/classify/index.ts'),
  tsModule('src/lib/content-upload/index.ts'),
  tsModule('src/lib/content-import/apply/decisions.ts'),
]);
const {
  assignFile,
  buildPositiveList,
  positiveListFromPaths,
  analyzeDuplicates,
  contentKeyOf,
} = classify;
const { readDocx, readPdf, paragraphsFromText } = upload;
const { parseDecisions } = decisionModule;

/** The target of the concept: share of files solved by rules alone. */
export const DEFAULT_MIN_RATIO = 92;

/** Known special cases of the source (concept 10.1), by content key. */
export const KNOWN_SPECIAL_KEYS = [
  'scenario:23b',
  'scenario:23c',
  'scenario:10m',
  'scenario:16c',
  'scenario:14i',
  'quiz:10b:low',
  'quiz:10b:medium',
  'quiz:10b:high',
  'quiz:16e:low',
  'quiz:16e:medium',
  'quiz:16e:high',
  'quiz:11c:low',
  'quiz:11c:medium',
  'quiz:11c:high',
  'quiz:1a:high',
  'use-case:5b',
];

/**
 * Files of the source whose folder does not match their content: the folder
 * says 23b, the text is scenario 23c (similarity 0.97 to the real 23c). The
 * truth from the path is wrong there. A wrong high band is exempt from the hard
 * criterion only when the proposal is exactly the content key given here (the
 * file follows its content), every other proposal still counts. The exempt
 * files are reported on their own.
 */
export const KNOWN_SOURCE_ANOMALIES = { 'scenario:23b': 'scenario:23c' };

/** Duplicates that the source is known to hold (concept 10.1). */
export const KNOWN_DUPLICATE_KEYS = [
  'global-quiz:01',
  'global-quiz:03',
  'global-quiz:04',
  'use-case:5b',
];

const TYPE = {
  enabler: 'enabler',
  quiz: 'quiz',
  scenario: 'scenario',
  'use-case': 'use_case',
  'global-quiz': 'global_quiz',
};
const BANDS = ['high', 'medium', 'low', 'conflict'];

/** The truth of a file: what pathInfo() reads from the full original path. */
export function truthOf(rel) {
  const info = pathInfo(rel);
  const pdf = info.type === 'pdf';
  const docType = pdf ? 'global_quiz' : (TYPE[info.type] ?? null);
  return {
    docType: pdf ? 'pdf_original' : docType,
    originalType: pdf ? 'global_quiz' : null,
    componentCode: info.component?.code ?? null,
    enablerCode: info.enablerCode,
    quizLevel: docType === 'quiz' ? info.difficulty : null,
    key: info.key,
  };
}

const sameAsTruth = (proposal, truth) =>
  proposal.docType === truth.docType &&
  (proposal.originalType ?? null) === truth.originalType &&
  proposal.componentCode === truth.componentCode &&
  proposal.enablerCode === truth.enablerCode &&
  proposal.quizLevel === truth.quizLevel;

/** A file that the measurement is about (no archive, overview, K18). */
function eligible(rel, includeExcluded) {
  const info = pathInfo(rel);
  if (['archive', 'overview', 'other'].includes(info.type)) return false;
  return includeExcluded || !info.component?.excluded;
}

const percent = (part, whole) =>
  whole === 0 ? 0 : Math.round((10000 * part) / whole) / 100;

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Positive list as if the database knew all folders of the tree. */
export function positiveListOfPaths(paths) {
  const input = positiveListFromPaths(paths);
  return buildPositiveList({
    components: input.components.map(c => ({
      ...c,
      origin: 'database',
      enablers: c.enablers.map(e => ({ ...e, origin: 'database' })),
    })),
  });
}

/**
 * Measures one mode over the read files.
 * @param {Array<{rel: string, format: 'docx'|'pdf', paragraphs: Array|null}>} files
 * @param {{ mode: 'path'|'names', positiveList: object, decisions: object, includeExcluded?: boolean }} options
 */
export function measureMode(files, options) {
  const { mode, positiveList, decisions, includeExcluded = false } = options;
  const rows = [];
  const times = [];
  for (const file of files) {
    if (!file.paragraphs || !eligible(file.rel, includeExcluded)) continue;
    const truth = truthOf(file.rel);
    const started = process.hrtime.bigint();
    const proposal = assignFile({
      relPath: mode === 'path' ? file.rel : file.rel.split('/').pop(),
      format: file.format,
      paragraphs: file.paragraphs,
      positiveList,
      decisions,
    });
    times.push(Number(process.hrtime.bigint() - started) / 1e6);
    rows.push({
      key: truth.key,
      type: pathInfo(file.rel).type,
      proposedKey: contentKeyOf(proposal),
      band: proposal.band,
      correct: sameAsTruth(proposal, truth),
      reasons: proposal.reasons.map(r => r.code),
    });
  }
  return summarizeRows(rows, times, mode);
}

/**
 * The numbers of one mode from the classified rows (pure, tested on its own).
 * @param {Array<{key: string|null, proposedKey?: string|null, type: string, band: string, correct: boolean, reasons: string[]}>} rows
 * @param {number[]} times milliseconds per file
 * @param {string} mode
 */
export function summarizeRows(rows, times, mode) {
  const n = rows.length;
  const count = test => rows.filter(test).length;
  const bands = Object.fromEntries(
    BANDS.map(b => [b, count(r => r.band === b)])
  );
  const correctResolved = count(
    r => (r.band === 'high' || r.band === 'medium') && r.correct
  );
  const wrongHighAll = rows.filter(r => r.band === 'high' && !r.correct);
  const wrongHighKnown = wrongHighAll.filter(
    r =>
      r.key !== null &&
      Object.hasOwn(KNOWN_SOURCE_ANOMALIES, r.key) &&
      r.proposedKey === KNOWN_SOURCE_ANOMALIES[r.key]
  ).length;
  const wrongHigh = wrongHighAll.length - wrongHighKnown;
  const wrongResolved = count(
    r => (r.band === 'high' || r.band === 'medium') && !r.correct
  );
  const byType = {};
  for (const row of rows) {
    const t = (byType[row.type] ??= {
      n: 0,
      high: 0,
      medium: 0,
      low: 0,
      conflict: 0,
      wrongResolved: 0,
    });
    t.n += 1;
    t[row.band] += 1;
    if ((row.band === 'high' || row.band === 'medium') && !row.correct) {
      t.wrongResolved += 1;
    }
  }
  const reasons = {};
  for (const row of rows.filter(r => r.band !== 'high')) {
    for (const code of row.reasons) reasons[code] = (reasons[code] ?? 0) + 1;
  }
  const sortedTimes = [...times].sort((a, b) => a - b);
  const special = rows.filter(r => KNOWN_SPECIAL_KEYS.includes(r.key ?? ''));
  return {
    mode,
    files: n,
    bands,
    shares: {
      high: percent(bands.high, n),
      medium: percent(bands.medium, n),
      unclear: percent(bands.low, n),
      conflict: percent(bands.conflict, n),
      // not sent to the model, whatever the result
      withoutModel: percent(n - bands.low, n),
      // resolved by rules (high or medium) and equal to the truth
      correctWithoutModel: percent(correctResolved, n),
    },
    // wrong with band high, without the known errors of the source
    wrongHigh,
    wrongHighKnownSourceError: wrongHighKnown,
    wrongResolved,
    byType,
    reasonsBelowHigh: reasons,
    assignMs: {
      median: Math.round(quantile(sortedTimes, 0.5) * 100) / 100,
      p95: Math.round(quantile(sortedTimes, 0.95) * 100) / 100,
      max: Math.round((sortedTimes.at(-1) ?? 0) * 100) / 100,
    },
    knownSpecial: {
      found: special.length,
      notHigh: special.filter(r => r.band !== 'high').length,
    },
    // content keys of what is below high or wrong (no paths, no text)
    keys: {
      belowHigh: rows
        .filter(r => r.band !== 'high')
        .map(r => r.key ?? '(no key)'),
      wrong: rows
        .filter(r => (r.band === 'high' || r.band === 'medium') && !r.correct)
        .map(r => `${r.key ?? '(no key)'}:${r.band}`),
      unclear: rows.filter(r => r.band === 'low').map(r => r.key ?? '(no key)'),
    },
  };
}

/** Duplicate groups over all read files (the tree, like the review list). */
export function measureDuplicates(files, { positiveList, decisions, now }) {
  const proposals = new Map();
  for (const file of files) {
    proposals.set(
      file.rel,
      assignFile({
        relPath: file.rel,
        format: file.format,
        paragraphs: file.paragraphs,
        positiveList,
        decisions,
      })
    );
  }
  const input = files.map(file => {
    const p = proposals.get(file.rel);
    const info = pathInfo(file.rel);
    return {
      id: file.rel,
      sha256: file.sha256,
      relPath: file.rel,
      mtimeMs: file.mtimeMs,
      archived: p.statusCode === 'ARCHIVE_PATH',
      excluded: p.statusCode === 'COMPONENT_EXCLUDED',
      withoutSolution: info.flags.includes('without-solution'),
      assignment: p.recognized
        ? {
            docType: p.docType,
            originalType: p.originalType,
            componentCode: p.componentCode,
            enablerCode: p.enablerCode,
            quizLevel: p.quizLevel,
          }
        : null,
      text: file.paragraphs
        ? file.paragraphs.map(x => x.text).join('\n')
        : null,
    };
  });
  const analysis = analyzeDuplicates(input, { now });
  const keyOf = id => proposals.get(id)?.dupKey ?? null;
  const groupKeys = new Set([
    ...analysis.keyGroups.map(g => g.key),
    ...analysis.exactGroups.map(g => keyOf(g.primaryId)).filter(Boolean),
  ]);
  return {
    exactGroups: analysis.exactGroups.length,
    mergedCopies: Object.keys(analysis.mergedInto).length,
    versionGroups: analysis.keyGroups.length,
    similarGroups: analysis.similarGroups.length,
    pdfOriginals: analysis.originals.length,
    pdfOriginalsBound: analysis.originals.filter(o => o.wordId).length,
    truncated: Boolean(analysis.truncated),
    knownDuplicates: {
      expected: KNOWN_DUPLICATE_KEYS.length,
      found: KNOWN_DUPLICATE_KEYS.filter(k => groupKeys.has(k)).length,
      missing: KNOWN_DUPLICATE_KEYS.filter(k => !groupKeys.has(k)),
    },
  };
}

class TimeoutError extends Error {}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError('timeout')), ms);
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
 * Reads the files one after the other (never several at once: OneDrive
 * downloads a placeholder on its first read). Three timeouts in a row stop.
 * @param {string} root
 * @param {Array<{rel: string, size: number, mtimeMs: number, placeholder: boolean}>} entries
 * @param {{ hydrate?: boolean, timeoutMs?: number, limit?: number, readBytes?: (file: string) => Promise<Buffer>, onProgress?: (done: number, total: number) => void }} [options]
 */
export async function readSource(root, entries, options = {}) {
  const {
    hydrate = false,
    timeoutMs = 60000,
    limit = Infinity,
    readBytes = readFile,
  } = options;
  const files = [];
  const stats = {
    listed: entries.length,
    placeholdersSkipped: 0,
    read: 0,
    unreadable: 0,
    timeouts: 0,
    aborted: false,
    readMs: [],
  };
  let timeoutsInARow = 0;
  const todo = entries.filter(e => {
    if (e.placeholder && !hydrate) {
      stats.placeholdersSkipped += 1;
      return false;
    }
    return true;
  });
  for (const entry of todo.slice(0, limit)) {
    const started = Date.now();
    const format = /\.pdf$/i.test(entry.rel) ? 'pdf' : 'docx';
    const record = {
      rel: entry.rel,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      format,
      sha256: null,
      paragraphs: null,
    };
    try {
      const buffer = await withTimeout(
        readBytes(path.join(root, ...entry.rel.split('/'))),
        timeoutMs
      );
      timeoutsInARow = 0;
      record.sha256 = createHash('sha256').update(buffer).digest('hex');
      const bytes = new Uint8Array(buffer);
      if (format === 'pdf') {
        const result = await readPdf(bytes);
        if (result.status === 'ok') {
          record.paragraphs = paragraphsFromText(result.text);
        }
      } else {
        const result = await readDocx(bytes);
        if (result.status === 'ok') record.paragraphs = result.paragraphs;
      }
      if (record.paragraphs) stats.read += 1;
      else stats.unreadable += 1;
    } catch (error) {
      stats.unreadable += 1;
      if (error instanceof TimeoutError) {
        stats.timeouts += 1;
        timeoutsInARow += 1;
      } else {
        timeoutsInARow = 0;
      }
      if (timeoutsInARow >= 3) {
        stats.aborted = true;
        files.push(record);
        break;
      }
    }
    stats.readMs.push(Date.now() - started);
    files.push(record);
    options.onProgress?.(files.length, Math.min(todo.length, limit));
  }
  return { files, stats };
}

/** Decides the exit code of a run (the gate). */
export function gateOf(modes, minRatio) {
  const failures = [];
  for (const m of modes) {
    if (m.shares.correctWithoutModel < minRatio) {
      failures.push(
        `${m.mode}: ${m.shares.correctWithoutModel} percent solved correctly without the model, target ${minRatio}`
      );
    }
    if (m.wrongHigh > 0) {
      failures.push(
        `${m.mode}: ${m.wrongHigh} file(s) with band high are wrong`
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Plain text summary in German, numbers only. */
export function renderSummary(report) {
  const out = [];
  const r = report.read;
  out.push('Golden Set der Regelstufe (nur Zahlen, keine Inhalte)');
  out.push('');
  out.push(
    `Dateien in der Quelle: ${r.listed}, gelesen: ${r.read}, nicht lesbar oder abgelehnt: ${r.unreadable}, Platzhalter übersprungen: ${r.placeholdersSkipped}`
  );
  const readMs = [...r.readMs].sort((a, b) => a - b);
  out.push(
    `Lesezeit je Datei: Median ${quantile(readMs, 0.5)} ms, 95 Prozent unter ${quantile(readMs, 0.95)} ms, Gesamtlauf ${Math.round(report.totalMs / 1000)} s`
  );
  for (const m of report.modes) {
    out.push('');
    out.push(
      `Modus ${m.mode === 'path' ? 'Pfadstruktur' : 'nur Dateiname'}: ${m.files} Dateien`
    );
    out.push(
      `  Band high ${m.bands.high} (${m.shares.high} %), medium ${m.bands.medium} (${m.shares.medium} %), unklar ${m.bands.low} (${m.shares.unclear} %), Widerspruch ${m.bands.conflict} (${m.shares.conflict} %)`
    );
    out.push(
      `  ohne KI richtig zugeordnet: ${m.shares.correctWithoutModel} % (Ziel ${report.minRatio} %), ohne Modellaufruf überhaupt: ${m.shares.withoutModel} %`
    );
    out.push(
      `  falsch mit Band high: ${m.wrongHigh} (dazu ${m.wrongHighKnownSourceError} bekannter Fehler der Quelle), falsch mit high oder medium: ${m.wrongResolved}`
    );
    out.push(
      `  Zuordnung je Datei: Median ${m.assignMs.median} ms, 95 Prozent unter ${m.assignMs.p95} ms, höchstens ${m.assignMs.max} ms`
    );
    out.push(
      `  bekannte Sonderfälle: ${m.knownSpecial.found} gefunden, davon ${m.knownSpecial.notHigh} nicht im Band high`
    );
    for (const [type, t] of Object.entries(m.byType)) {
      out.push(
        `  ${type}: ${t.n} (high ${t.high}, medium ${t.medium}, unklar ${t.low}, Widerspruch ${t.conflict}, falsch gelöst ${t.wrongResolved})`
      );
    }
    if (report.showKeys) {
      out.push(`  unklar: ${m.keys.unclear.join(' ') || '(keine)'}`);
      out.push(`  falsch gelöst: ${m.keys.wrong.join(' ') || '(keine)'}`);
    }
  }
  const d = report.duplicates;
  out.push('');
  out.push(
    `Dubletten: ${d.exactGroups} Gruppen exakter Kopien (${d.mergedCopies} Kopien zusammengefasst), ${d.versionGroups} Fassungsgruppen, ${d.similarGroups} Ähnlichkeitsgruppen, ${d.pdfOriginalsBound} von ${d.pdfOriginals} PDF an ihre Word-Datei gebunden`
  );
  out.push(
    `  bekannte Dubletten erkannt: ${d.knownDuplicates.found} von ${d.knownDuplicates.expected}${d.knownDuplicates.missing.length ? ` (fehlt: ${d.knownDuplicates.missing.join(' ')})` : ''}`
  );
  out.push('');
  out.push(
    report.gate.ok
      ? `Ergebnis: Ziel erreicht (mindestens ${report.minRatio} % ohne KI, kein falsches high).`
      : `Ergebnis: Ziel verfehlt. ${report.gate.failures.join('; ')}`
  );
  return out.join('\n');
}

/**
 * The whole measurement over a list of already read files.
 * @param {Array} files from readSource
 */
export function buildReport(files, readStats, options) {
  const {
    modes = ['path', 'names'],
    minRatio = DEFAULT_MIN_RATIO,
    decisions,
    includeExcluded = false,
    now = Date.now(),
    showKeys = false,
    totalMs = 0,
  } = options;
  const positiveList = positiveListOfPaths(files.map(f => f.rel));
  const measured = modes.map(mode =>
    measureMode(files, { mode, positiveList, decisions, includeExcluded })
  );
  const duplicates = measureDuplicates(
    files.filter(f => f.paragraphs),
    { positiveList, decisions, now }
  );
  return {
    read: readStats,
    modes: measured,
    duplicates,
    minRatio,
    gate: gateOf(measured, minRatio),
    showKeys,
    totalMs,
  };
}

const usage =
  'Usage: node scripts/import/kfbm-golden-set.mjs <source folder> [--mode path,names] [--min-ratio <percent>] [--hydrate] [--timeout <seconds>] [--limit <n>] [--include-k18] [--show-keys] [--out <file.json>]';

const BOOLEAN_FLAGS = ['--hydrate', '--include-k18', '--show-keys'];
const VALUE_FLAGS = ['--mode', '--min-ratio', '--timeout', '--limit', '--out'];

/**
 * Reads the command line strictly: one source folder, known flags only, every
 * flag that needs a value has one. Returns { ok: false } for anything else.
 */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (BOOLEAN_FLAGS.includes(a)) flags[a] = true;
    else if (VALUE_FLAGS.includes(a)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { ok: false };
      flags[a] = value;
      i += 1;
    } else if (a.startsWith('--')) return { ok: false };
    else positional.push(a);
  }
  if (positional.length !== 1) return { ok: false };
  const modes = (flags['--mode'] ?? 'path,names').split(',');
  if (modes.some(m => m !== 'path' && m !== 'names')) return { ok: false };
  const minRatio = Number(flags['--min-ratio'] ?? DEFAULT_MIN_RATIO);
  const timeoutMs = Number(flags['--timeout'] ?? 60) * 1000;
  const limit =
    flags['--limit'] === undefined ? Infinity : Number(flags['--limit']);
  if (
    !Number.isFinite(minRatio) ||
    minRatio < 0 ||
    minRatio > 100 ||
    !(timeoutMs > 0) ||
    !(limit === Infinity || (Number.isInteger(limit) && limit > 0))
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    root: path.resolve(positional[0]),
    modes,
    minRatio,
    timeoutMs,
    limit,
    hydrate: flags['--hydrate'] === true,
    includeExcluded: flags['--include-k18'] === true,
    showKeys: flags['--show-keys'] === true,
    out: flags['--out'] ?? null,
  };
}

export async function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(usage);
    return 2;
  }
  const { root, modes, minRatio, timeoutMs, limit, out } = parsed;

  const decisionResult = parseDecisions(
    JSON.parse(
      readFileSync(
        path.join(ROOT, 'scripts/import/kfbm-decisions.json'),
        'utf8'
      )
    )
  );
  if (!decisionResult.ok) {
    console.error(
      'The presets are invalid: ' + decisionResult.errors.join('; ')
    );
    return 2;
  }

  const started = Date.now();
  const entries = walkSource(root, { attributes: readAttributes(root) }).filter(
    e => /\.(docx|pdf)$/i.test(e.rel)
  );
  const { files, stats } = await readSource(root, entries, {
    hydrate: parsed.hydrate,
    timeoutMs,
    limit,
    onProgress: (done, total) => {
      if (done % 250 === 0) process.stderr.write(`read ${done} of ${total}\n`);
    },
  });
  const report = buildReport(files, stats, {
    modes,
    minRatio,
    decisions: decisionResult.decisions,
    includeExcluded: parsed.includeExcluded,
    showKeys: parsed.showKeys,
    totalMs: Date.now() - started,
  });
  console.log(renderSummary(report));
  if (out) {
    // keys are listed in the file only on request, like on the screen
    const json = {
      read: report.read,
      modes: report.modes.map(m =>
        report.showKeys ? m : { ...m, keys: undefined }
      ),
      duplicates: report.duplicates,
      minRatio: report.minRatio,
      gate: report.gate,
      totalMs: report.totalMs,
    };
    try {
      writeFileSync(out, JSON.stringify(json, null, 2));
    } catch (error) {
      // the result of the gate must not be lost because of a file that cannot be written
      console.error(
        `The numbers could not be written to the file: ${error.code ?? 'error'}`
      );
    }
  }
  if (stats.aborted || stats.unreadable > Math.max(10, stats.read * 0.05)) {
    console.error(
      'Too many files could not be read, the numbers are not reliable.'
    );
    return 2;
  }
  return report.gate.ok ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    }
  );
}
