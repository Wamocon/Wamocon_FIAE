// Inventory of the KfBM source folder (phase 4.0 of the content import).
//
// Walks the source folder WITHOUT loading contents (only names, sizes, times
// and file attributes), derives component, group, enabler letter and type of
// every file from its path (src/lib/content-import/path-info.ts) and reports:
//   - the numbers per component and type, against the expected values,
//   - missing blocks (enabler without a quiz of a level, without a scenario or,
//     when the source has use cases at all, without a use case),
//   - the use cases (files per format, folders "Ohne Musterlösung", per
//     component in the table),
//   - duplicates (same derived key, several files: size, date, recommendation),
//   - files that fit no scheme (implausible names),
//   - OneDrive placeholders (files that are not downloaded yet),
//   - files in the sibling folders that repeat a name of the source (names and
//     sizes only).
//
// Read only: no network, no database, no model call. The source is never
// changed or copied.
//
// Usage:
//   node scripts/import/kfbm-inventory.mjs <source folder> [--out <file.json>]
//        [--siblings <folder>] [--no-siblings] [--no-attributes]
// With --out the JSON goes to that file and a short summary in Markdown next to
// it (same name, .md). Without --out the summary is printed.
// --siblings defaults to the parent of the source folder.

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  listFolder,
  pathInfo,
  readAttributes,
  walkSource,
} from './kfbm-source.mjs';

/** Numbers the plan expects (27 components without K18). */
export const EXPECTED = {
  components: 27,
  enablers: 226,
  scenarios: 226,
  globalQuizzes: 27,
  electives: 9,
  quizzes: 678,
  // One use case per enabler.
  useCases: 226,
};

/** Folders next to the source that are only listed by name and size. */
export const SIBLING_FOLDERS = [
  'Komponenten_PDF',
  'Quizze',
  'Szenarien',
  'Szenarien (1)',
  'Use Cases',
  'Excels',
];

const LEVELS = ['low', 'medium', 'high'];
const iso = ms => new Date(ms).toISOString();
const baseName = rel => rel.split('/').pop() ?? rel;
const stem = rel =>
  baseName(rel)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[\s_]+/g, '_');

/** Newest first: highest version, then latest change, then largest. */
function recommend(files) {
  const sorted = [...files].sort(
    (a, b) =>
      (b.version ?? 0) - (a.version ?? 0) ||
      b.mtimeMs - a.mtimeMs ||
      b.size - a.size
  );
  const [best, second] = sorted;
  let reason = 'newest modification date';
  if ((best.version ?? 0) > (second.version ?? 0)) {
    reason = `highest version v${best.version}`;
  } else if (best.mtimeMs === second.mtimeMs) {
    reason = 'same date, largest file';
  }
  return { recommended: best.rel, reason };
}

/**
 * Builds the inventory from the walked entries.
 * @param {Array<{rel: string, size: number, mtimeMs: number, attributes: number | null, placeholder: boolean}>} entries
 * @param {{ expected?: Record<string, number>, siblings?: Array<{name: string, files: Array<{rel: string, size: number, mtimeMs: number}>, error?: string}> }} [options]
 */
export function buildInventory(
  entries,
  { expected = EXPECTED, siblings = [] } = {}
) {
  const records = entries.map(entry => ({
    ...entry,
    info: pathInfo(entry.rel),
  }));

  const totals = {
    files: records.length,
    bytes: 0,
    placeholders: 0,
    placeholderBytes: 0,
    byExtension: {},
  };
  const archive = [];
  const misfits = [];
  const flags = {};
  const excluded = { files: 0, components: [] };
  const groups = new Map(); // key -> records (not archive, not excluded)
  const components = new Map();
  const enablerIds = new Map(); // key -> {component, has: Set}
  const useCaseFiles = {
    files: 0,
    byFormat: {},
    withoutSolutionFolder: [],
    misplacedEnablerTexts: 0,
  };

  for (const record of records) {
    const { info } = record;
    totals.bytes += record.size;
    totals.byExtension[info.format || '(none)'] =
      (totals.byExtension[info.format || '(none)'] ?? 0) + 1;
    if (record.placeholder) {
      totals.placeholders += 1;
      totals.placeholderBytes += record.size;
    }
    for (const flag of info.flags) flags[flag] = (flags[flag] ?? 0) + 1;
    if (info.issues.length > 0 || info.type === 'other') {
      misfits.push({
        rel: record.rel,
        type: info.type,
        issues: info.issues.length > 0 ? info.issues : ['no-schema'],
      });
    }

    const component = info.component;
    if (component) {
      let row = components.get(component.key);
      if (!row) {
        row = {
          key: component.key,
          code: component.code,
          title: null,
          paragraph: null,
          group: info.group,
          elective: component.elective,
          excluded: component.excluded,
          files: 0,
          placeholders: 0,
          keys: new Map(),
        };
        components.set(component.key, row);
      }
      if (component.title && !row.title) {
        row.title = component.title;
        row.paragraph = component.paragraph;
        if (info.folderGroup !== 'global') row.group = info.group;
      }
      row.files += 1;
      if (record.placeholder) row.placeholders += 1;
      if (info.key && info.type !== 'archive')
        row.keys.set(info.key, info.type);
    }

    if (component?.excluded) {
      excluded.files += 1;
      if (!excluded.components.includes(component.key)) {
        excluded.components.push(component.key);
      }
      continue;
    }
    if (info.type === 'archive') {
      archive.push(record.rel);
      continue;
    }
    if (info.type === 'use-case') {
      useCaseFiles.files += 1;
      useCaseFiles.byFormat[info.format || '(none)'] =
        (useCaseFiles.byFormat[info.format || '(none)'] ?? 0) + 1;
      if (info.flags.includes('without-solution')) {
        useCaseFiles.withoutSolutionFolder.push(record.rel);
      }
    } else if (info.type === 'enabler' && info.flags.includes('misplaced')) {
      // An enabler text that lies in a use case folder.
      useCaseFiles.misplacedEnablerTexts += 1;
    }
    if (info.key && info.key !== 'overview') {
      if (!groups.has(info.key)) groups.set(info.key, []);
      groups.get(info.key).push(record);
    }
    if (
      info.enablerKey &&
      ['enabler', 'quiz', 'scenario', 'use-case'].includes(info.type)
    ) {
      // A file whose name is not recognized has no key and does not count as the
      // block, the enabler still exists and then shows the block as missing.
      let id = enablerIds.get(info.enablerKey);
      if (!id) {
        id = { component: component?.key ?? null, has: new Set() };
        enablerIds.set(info.enablerKey, id);
      }
      if (info.key) {
        id.has.add(
          info.type === 'quiz' ? `quiz:${info.difficulty ?? '?'}` : info.type
        );
      }
    }
  }

  // Unique counts: one per derived key.
  const uniqueKeys = [...groups.keys()];
  const countWith = prefix =>
    uniqueKeys.filter(k => k.startsWith(prefix)).length;
  const keyedComponents = [...components.values()].filter(c => !c.excluded);
  const counts = {
    components: keyedComponents.length,
    enablers: countWith('enabler:'),
    enablerIds: enablerIds.size,
    scenarios: countWith('scenario:'),
    quizzes: countWith('quiz:'),
    globalQuizzes: countWith('global-quiz:'),
    electives: keyedComponents.filter(c => c.elective).length,
    useCases: countWith('use-case:'),
    globalQuizPdfs: countWith('pdf:global-quiz:'),
  };
  const expectations = Object.entries(expected).map(([name, value]) => ({
    name,
    expected: value,
    actual: counts[name],
    ok: counts[name] === value,
  }));

  const hasUseCases = useCaseFiles.files > 0;
  const missing = [];
  for (const [enablerKey, id] of enablerIds) {
    const absent = [];
    if (!id.has.has('enabler')) absent.push('enabler');
    for (const level of LEVELS) {
      if (!id.has.has(`quiz:${level}`)) absent.push(`quiz:${level}`);
    }
    if (!id.has.has('scenario')) absent.push('scenario');
    if (hasUseCases && !id.has.has('use-case')) absent.push('use-case');
    if (absent.length > 0) {
      missing.push({ enablerKey, component: id.component, missing: absent });
    }
  }
  missing.sort((a, b) =>
    a.enablerKey.localeCompare(b.enablerKey, 'en', { numeric: true })
  );

  const duplicates = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const files = group.map(r => ({
      rel: r.rel,
      size: r.size,
      mtime: iso(r.mtimeMs),
      mtimeMs: r.mtimeMs,
      version: r.info.version,
      placeholder: r.placeholder,
    }));
    const { recommended, reason } = recommend(files);
    duplicates.push({
      key,
      type: group[0].info.type,
      files: files.map(f => ({
        rel: f.rel,
        size: f.size,
        mtime: f.mtime,
        version: f.version,
        placeholder: f.placeholder,
      })),
      recommended,
      reason,
      sameSize: new Set(files.map(f => f.size)).size === 1,
      namesDiffer:
        new Set(files.map(f => baseName(f.rel).toLowerCase())).size > 1,
    });
  }
  duplicates.sort((a, b) =>
    a.key.localeCompare(b.key, 'en', { numeric: true })
  );

  const componentRows = [...components.values()]
    .map(row => {
      const keys = [...row.keys.entries()];
      const of = type => keys.filter(([, t]) => t === type).length;
      const level = name =>
        keys.filter(([k]) => k.startsWith('quiz:') && k.endsWith(`:${name}`))
          .length;
      return {
        key: row.key,
        code: row.code,
        title: row.title,
        paragraph: row.paragraph,
        group: row.group,
        elective: row.elective,
        excluded: row.excluded,
        files: row.files,
        placeholders: row.placeholders,
        enablers: of('enabler'),
        quizzes: {
          low: level('low'),
          medium: level('medium'),
          high: level('high'),
        },
        scenarios: of('scenario'),
        useCases: of('use-case'),
        globalQuiz: keys.some(([k]) => k.startsWith('global-quiz:')),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));

  // Siblings: names and sizes only, matched to the source by file name.
  const sourceByStem = new Map();
  for (const record of records) {
    const s = stem(record.rel);
    if (!sourceByStem.has(s)) sourceByStem.set(s, []);
    sourceByStem.get(s).push(record);
  }
  const siblingRows = siblings.map(folder => {
    const duplicatesOfSource = [];
    for (const file of folder.files) {
      const hits = sourceByStem.get(stem(file.rel));
      if (!hits) continue;
      duplicatesOfSource.push({
        rel: file.rel,
        size: file.size,
        mtime: iso(file.mtimeMs),
        source: hits.map(h => h.rel),
        sameSize: hits.some(h => h.size === file.size),
      });
    }
    return {
      name: folder.name,
      files: folder.files.length,
      bytes: folder.files.reduce((sum, f) => sum + f.size, 0),
      ...(folder.error ? { error: folder.error } : {}),
      duplicates: duplicatesOfSource,
    };
  });

  return {
    totals,
    counts,
    expectations,
    components: componentRows,
    useCaseFiles,
    missing,
    duplicates,
    misfits,
    archive,
    flags,
    excluded,
    siblings: siblingRows,
  };
}

const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const cell = text => String(text ?? '').replace(/\|/g, '/');

/** Short summary in Markdown (German). */
export function renderSummary(inv, { root = null, generatedAt = null } = {}) {
  const out = [];
  out.push('# Inventur der KfBM-Quellen');
  out.push('');
  if (root) out.push(`Quelle: \`${root}\``);
  if (generatedAt) out.push(`Stand: ${generatedAt}`);
  out.push(
    `Nur Namen, Größen und Attribute gelesen, keine Inhalte. ${inv.totals.files} Dateien, ${mb(inv.totals.bytes)}.`
  );
  out.push('');

  out.push('## Erwartung und Ist');
  out.push('');
  out.push('| Größe | Erwartet | Ist | Ergebnis |');
  out.push('|---|---|---|---|');
  const labels = {
    components: 'Komponenten (ohne K18)',
    enablers: 'Enabler (Lehrtexte)',
    scenarios: 'Szenarien',
    globalQuizzes: 'Global-Quizze',
    electives: 'Wahlkomponenten',
    quizzes: 'Quizze (Stufe leicht, mittel, schwer)',
    useCases: 'Use Cases (je Enabler einer)',
  };
  for (const row of inv.expectations) {
    out.push(
      `| ${labels[row.name] ?? row.name} | ${row.expected} | ${row.actual} | ${row.ok ? 'stimmt' : 'weicht ab'} |`
    );
  }
  out.push('');
  out.push(
    `Enabler-Kennungen gesamt (Text, Quiz oder Szenario): ${inv.counts.enablerIds}. Use Cases: ${inv.counts.useCases}. PDF der Global-Quizze: ${inv.counts.globalQuizPdfs}. K18 ausgeschlossen: ${inv.excluded.files} Dateien.`
  );
  out.push('');

  const uc = inv.useCaseFiles;
  if (uc) {
    out.push('## Use Cases');
    out.push('');
    out.push(
      `${uc.files} Dateien (ohne K18 und Archiv), davon ${inv.counts.useCases} verschiedene Schlüssel (ein Use Case je Enabler). Dateitypen: ${
        Object.entries(uc.byFormat)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') || 'keine'
      }. Lehrtexte im Use-Case-Ordner (nicht Teil des Use-Case-Imports): ${uc.misplacedEnablerTexts}.`
    );
    if (uc.withoutSolutionFolder.length > 0) {
      out.push('');
      out.push(
        'Ordner "Ohne Musterlösung" (die Fassung mit und die ohne Musterlösung nebeneinander gelten als Konflikt, der Import überspringt beide):'
      );
      for (const rel of uc.withoutSolutionFolder) out.push(`- \`${rel}\``);
    }
    out.push('');
  }

  out.push('## Je Komponente');
  out.push('');
  out.push(
    '| Komponente | Gruppe | Titel | Enabler | Quiz L/M/H | Szenarien | Use Cases | Global | Dateien | Platzhalter |'
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const c of inv.components) {
    out.push(
      `| ${c.code}${c.excluded ? ' (ausgeschlossen)' : ''} | ${c.group ?? ''} | ${cell(c.title)} | ${c.enablers} | ${c.quizzes.low}/${c.quizzes.medium}/${c.quizzes.high} | ${c.scenarios} | ${c.useCases} | ${c.globalQuiz ? 'ja' : 'nein'} | ${c.files} | ${c.placeholders} |`
    );
  }
  out.push('');

  out.push('## Fehlende Bausteine');
  out.push('');
  if (inv.missing.length === 0) {
    out.push(
      'Keine. Jeder Enabler hat Text, drei Quiz-Stufen, ein Szenario und (wenn die Quelle Use Cases hat) einen Use Case.'
    );
  } else {
    out.push(`${inv.missing.length} Enabler mit Lücken:`);
    out.push('');
    out.push('| Enabler | Fehlt |');
    out.push('|---|---|');
    for (const m of inv.missing) {
      out.push(`| ${m.enablerKey} | ${m.missing.join(', ')} |`);
    }
  }
  out.push('');

  out.push('## Dubletten');
  out.push('');
  if (inv.duplicates.length === 0) {
    out.push('Keine.');
  } else {
    out.push(
      `${inv.duplicates.length} Schlüssel mit mehreren Dateien. Empfehlung: die neueste Fassung (höchste Version, sonst jüngstes Änderungsdatum).`
    );
    out.push('');
    for (const d of inv.duplicates) {
      out.push(
        `- \`${d.key}\`${d.namesDiffer ? ' (Dateinamen verschieden, Inhalt prüfen)' : ''}${d.sameSize ? ' (gleiche Größe)' : ''}`
      );
      for (const f of d.files) {
        out.push(
          `  - ${f.rel === d.recommended ? 'EMPFOHLEN ' : ''}\`${f.rel}\`, ${mb(f.size)}, ${f.mtime.slice(0, 10)}${f.version ? `, v${f.version}` : ''}${f.placeholder ? ', Platzhalter' : ''}`
        );
      }
      out.push(`  - Grund: ${d.reason}`);
    }
  }
  out.push('');

  out.push('## Passt in kein Schema');
  out.push('');
  if (inv.misfits.length === 0) {
    out.push('Keine.');
  } else {
    const byIssue = {};
    for (const m of inv.misfits) {
      for (const issue of m.issues) byIssue[issue] = (byIssue[issue] ?? 0) + 1;
    }
    out.push(
      `${inv.misfits.length} Dateien. Gründe: ${Object.entries(byIssue)
        .map(([k, v]) => `${k} (${v})`)
        .join(', ')}.`
    );
    out.push('');
    for (const m of inv.misfits.slice(0, 40)) {
      out.push(`- \`${m.rel}\`: ${m.issues.join(', ')}`);
    }
    if (inv.misfits.length > 40) {
      out.push(`- und ${inv.misfits.length - 40} weitere (siehe JSON)`);
    }
  }
  out.push('');
  if (inv.archive.length > 0) {
    out.push(
      `Archivdateien (Old_To_Delete, Archivordner), nicht gezählt: ${inv.archive.length}.`
    );
    for (const rel of inv.archive) out.push(`- \`${rel}\``);
    out.push('');
  }
  if (Object.keys(inv.flags).length > 0) {
    out.push(
      `Hinweise: ${Object.entries(inv.flags)
        .map(([k, v]) => `${k} (${v})`)
        .join(', ')}.`
    );
    out.push('');
  }

  out.push('## Platzhalter');
  out.push('');
  out.push(
    `${inv.totals.placeholders} von ${inv.totals.files} Dateien sind OneDrive-Platzhalter (${mb(inv.totals.placeholderBytes)}), ${inv.totals.files - inv.totals.placeholders} liegen auf dem Gerät.`
  );
  out.push('');
  out.push(
    `Dateitypen: ${Object.entries(inv.totals.byExtension)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}.`
  );
  out.push('');

  out.push('## Geschwisterordner');
  out.push('');
  if (inv.siblings.length === 0) {
    out.push('Nicht geprüft.');
  } else {
    out.push(
      'Nur Namen und Größen. Treffer = gleicher Dateiname ohne Endung wie in der Quelle (Word und PDF zählen als gleich).'
    );
    out.push('');
    out.push('| Ordner | Dateien | Größe | Treffer | davon gleiche Größe |');
    out.push('|---|---|---|---|---|');
    for (const s of inv.siblings) {
      out.push(
        `| ${cell(s.name)}${s.error ? ` (Fehler: ${cell(s.error)})` : ''} | ${s.files} | ${mb(s.bytes)} | ${s.duplicates.length} | ${s.duplicates.filter(d => d.sameSize).length} |`
      );
    }
  }
  out.push('');
  return out.join('\n');
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function positional(argv) {
  const withValue = new Set(['--out', '--siblings']);
  for (let i = 0; i < argv.length; i += 1) {
    if (withValue.has(argv[i])) i += 1;
    else if (!argv[i].startsWith('--')) return argv[i];
  }
  return undefined;
}

function main() {
  const argv = process.argv.slice(2);
  const root = positional(argv);
  if (!root) {
    console.error(
      'Usage: node scripts/import/kfbm-inventory.mjs <source folder> [--out <file.json>] [--siblings <folder>] [--no-siblings] [--no-attributes]'
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

  let siblings = [];
  if (!argv.includes('--no-siblings')) {
    const parent =
      argValue(argv, '--siblings') ?? path.dirname(path.resolve(root));
    siblings = SIBLING_FOLDERS.map(name => ({
      name,
      ...listFolder(path.join(parent, name)),
    }));
  }

  const inventory = {
    root: path.resolve(root),
    generatedAt: new Date().toISOString(),
    ...buildInventory(entries, { siblings }),
  };
  const summary = renderSummary(inventory, {
    root: inventory.root,
    generatedAt: inventory.generatedAt,
  });
  const out = argValue(argv, '--out');
  if (out) {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify(inventory, null, 2), 'utf8');
    const md = out.replace(/\.json$/i, '') + '.md';
    writeFileSync(md, summary, 'utf8');
    console.log(`Inventory written: ${out} and ${md}`);
  } else {
    console.log(summary);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
