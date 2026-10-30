// FIAE documents of the Word delivery (06-01-26 LFA\FIAE\Komponenten) into the Preview: the teaching
// text of every enabler (THEORY), the parts of its scenario (EXERCISE) and the model solution of the
// use cases (TRAINER_SOLUTION) are converted to PDF and replace the documents of the same enabler or
// use case. Only the Preview exists as a target, there is no switch for Production.
//
// What replace means: the new PDF is stored under a NEW path (preview/fiae/...), the row of the old
// document is changed to point to it, the old file stays in the storage. The report names the old
// values of every row, so a run can be turned back by writing them again. A part of a scenario that
// has no row yet gets one. Nothing is deleted. Enablers and use cases are never created: a folder
// without a match in the Preview is reported and left out.
//
// Commands:
//   plan <source> --target preview [--components 01,02] [--limit N]
//        Read only. Matches every component folder to a course, every enabler folder to an enabler and
//        every file to a row, counts what would be replaced or added, names what has no match.
//   run  <source> --target preview [--apply] --confirm-host <db host> --confirm-storage-host <host>
//        [--components ...] [--limit N] [--soffice <path>] [--created-by <profile uuid>] [--out report.json]
//        Without --apply it only plans (nothing converted, nothing stored). With --apply it converts
//        file after file with LibreOffice, stores the PDF and, per component, writes the rows in one
//        transaction. A second run finds the rows pointing to the new paths and does nothing.
//
// Connection: DB_CONNECTION_STRING (role app_preview_migrator), storage: NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SECRET_KEY, all from the environment. The script prints no key, no connection string and no
// content of a file.

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  createLibreOfficeConverter,
  createWorkspace,
  findSoffice,
} from './kfbm-word-pdf.mjs';
import {
  openVerifiedClient,
  prepareConnection,
  redact,
} from './kfbm-session.mjs';
import {
  checkConfirmStorageHost,
  checkStorageTarget,
  cleanPdfMetadata,
  createSupabaseStorage,
} from './kfbm-documents-modules.mjs';

const CONTENT_BUCKET = 'content';
const SOLUTIONS_BUCKET = 'content-solutions';
const PREFIX = 'preview/fiae/';
const MAX_PDF_BYTES = 45 * 1024 * 1024;
// components that are delivered later (decision of the owner, 30.10.2026): the four enablers of
// 22_Sicherstellen der Qualität (Vertiefung) come after
const DEFERRED = new Set(['22']);
// components that are a Vertiefung (the second course of a pair in the Preview)
const VERTIEFUNG = new Set([13, 14, 15, 16, 17, 18, 20, 21, 22]);

// ---------------------------------------------------------------- arguments

export function parseArgs(argv) {
  const out = {
    command: null,
    source: null,
    target: null,
    apply: false,
    confirmHost: null,
    confirmStorageHost: null,
    components: null,
    limit: null,
    soffice: null,
    createdBy: null,
    out: null,
    errors: [],
  };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      out.errors.push(`${name} needs a value.`);
      return null;
    }
    return v;
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--target') {
      out.target = value(i, a);
      i++;
    } else if (a === '--confirm-host') {
      out.confirmHost = value(i, a);
      i++;
    } else if (a === '--confirm-storage-host') {
      out.confirmStorageHost = value(i, a);
      i++;
    } else if (a === '--components') {
      const v = value(i, a);
      i++;
      out.components = v
        ? v.split(',').map(x => x.trim().padStart(2, '0'))
        : null;
    } else if (a === '--limit') {
      out.limit = Number(value(i, a));
      i++;
      if (!Number.isInteger(out.limit) || out.limit < 1)
        out.errors.push('--limit needs a number.');
    } else if (a === '--soffice') {
      out.soffice = value(i, a);
      i++;
    } else if (a === '--created-by') {
      out.createdBy = value(i, a);
      i++;
    } else if (a === '--out') {
      out.out = value(i, a);
      i++;
    } else if (a.startsWith('--')) out.errors.push(`Unknown option ${a}.`);
    else rest.push(a);
  }
  [out.command, out.source] = rest;
  if (!['plan', 'run', 'rollback'].includes(out.command))
    out.errors.push('The command is plan, run or rollback.');
  if (!out.source)
    out.errors.push(
      'The source folder (or the report file for rollback) is missing.'
    );
  if (out.target !== 'preview')
    out.errors.push(
      'Every run needs --target preview. Production is not possible.'
    );
  if (out.apply && out.command === 'plan')
    out.errors.push('--apply belongs to run and rollback.');
  if (out.apply && !out.confirmStorageHost)
    out.errors.push('A real run needs --confirm-storage-host.');
  return out;
}

// ---------------------------------------------------------------- name matching

const letters = s =>
  String(s ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/­/g, '')
    .replace(/[^a-z]+/g, '');

/** Dice coefficient of the letter pairs, 0 to 1. */
export function similarity(a, b) {
  const x = letters(a);
  const y = letters(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const pairs = s => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++)
      m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const px = pairs(x);
  const py = pairs(y);
  let hit = 0;
  for (const [k, n] of px) hit += Math.min(n, py.get(k) ?? 0);
  return (2 * hit) / (x.length - 1 + (y.length - 1));
}

const courseBase = t =>
  String(t)
    .replace(/\(.*?\)/g, ' ')
    .replace(/§.*$/, ' ')
    .replace(/^\s*\d+[_ .-]+/, '')
    .trim();

/** Component folder number -> course of the Preview (one to one, or error texts). */
export function mapComponents(folders, courses) {
  const map = new Map();
  const problems = [];
  for (const f of folders) {
    const base = courseBase(f.title);
    const cands = courses
      .map(c => ({ c, s: similarity(base, courseBase(c.title)) }))
      .filter(x => x.s >= 0.6)
      .sort((a, b) => b.s - a.s);
    let pick = null;
    if (cands.length === 1) pick = cands[0].c;
    else if (cands.length > 1) {
      const wantV = VERTIEFUNG.has(f.nr);
      const both = cands.filter(x => /vertiefung/i.test(x.c.title) === wantV);
      pick = (both[0] ?? cands[0]).c;
    }
    if (!pick) problems.push(`No course for component ${f.nr}.`);
    else map.set(f.nr, pick);
  }
  const used = new Set();
  for (const [nr, c] of map) {
    if (used.has(c.id))
      problems.push(`Two components claim the same course (${nr}).`);
    used.add(c.id);
  }
  return { map, problems };
}

/** Enabler folders -> enablers of one course, greedy by similarity, then the last free pair. */
export function matchEnablers(folderEnablers, dbEnablers) {
  const pairs = [];
  folderEnablers.forEach((f, i) =>
    dbEnablers.forEach((e, j) =>
      pairs.push({ i, j, s: similarity(f.title, e.title) })
    )
  );
  pairs.sort((a, b) => b.s - a.s);
  const byFolder = new Map();
  const usedDb = new Set();
  for (const p of pairs) {
    if (p.s < 0.6 || byFolder.has(p.i) || usedDb.has(p.j)) continue;
    byFolder.set(p.i, { e: dbEnablers[p.j], how: 'title' });
    usedDb.add(p.j);
  }
  // what is left: the same number of folders and enablers (a shortened folder name does not match its
  // title) goes in the order of the numbers, as long as there are only a few
  const freeF = folderEnablers.map((_, i) => i).filter(i => !byFolder.has(i));
  const freeD = dbEnablers.map((_, j) => j).filter(j => !usedDb.has(j));
  if (freeF.length > 0 && freeF.length === freeD.length && freeF.length <= 3) {
    freeF.forEach((i, k) =>
      byFolder.set(i, { e: dbEnablers[freeD[k]], how: 'order' })
    );
  }
  return byFolder;
}

export const ascii = s =>
  String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ­]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

// ---------------------------------------------------------------- source folder

function listDir(p) {
  try {
    return readdirSync(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** "1a_Use-Case_...", "Use Case_4b_...", "Use Cases_6d- ...": number and letter of the use case. */
export function keyOfUseCaseFile(name) {
  const m = /^\s*(?:use[-_ ]?cases?[_ -]*)?(\d+)\s*([a-z])(?![a-z])/i.exec(
    name
  );
  return m ? `${Number(m[1])}${m[2].toUpperCase()}` : null;
}

function ucItem(file, name) {
  return { file, name, key: keyOfUseCaseFile(name) };
}

/** The component folders with their enablers (main file, scenario parts) and use case files. */
export function readSource(root) {
  const comps = [];
  for (const d of listDir(root)) {
    if (!d.isDirectory()) continue;
    const m = /^(\d+)[_ ]/.exec(d.name);
    if (!m) continue;
    const dir = path.join(root, d.name);
    const comp = {
      nr: Number(m[1]),
      key: m[1].padStart(2, '0'),
      title: d.name,
      dir,
      enablers: [],
      useCases: [],
      withoutSolution: [],
    };
    for (const e of listDir(path.join(dir, 'Enablers'))) {
      if (!e.isDirectory()) continue;
      const mm = /^(\d+)[a-z]?_(.*)$/.exec(e.name);
      const edir = path.join(dir, 'Enablers', e.name);
      const files = listDir(edir).filter(
        x => x.isFile() && /\.docx$/i.test(x.name)
      );
      const main =
        files.find(f => path.parse(f.name).name === e.name) ?? files[0] ?? null;
      const parts = listDir(path.join(edir, 'Szenario parts'))
        .filter(x => x.isFile() && /\.docx$/i.test(x.name))
        .map(x => {
          const pm = /^Part\s*(\d+)[_ -]*(.*)\.docx$/i.exec(x.name);
          return pm
            ? {
                n: Number(pm[1]),
                slug: pm[2],
                file: path.join(edir, 'Szenario parts', x.name),
              }
            : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.n - b.n);
      comp.enablers.push({
        nr: mm ? Number(mm[1]) : 0,
        key: mm ? mm[1].padStart(2, '0') : '00',
        title: mm ? mm[2] : e.name,
        folder: e.name,
        main: main ? path.join(edir, main.name) : null,
        parts,
      });
    }
    comp.enablers.sort((a, b) => a.nr - b.nr);
    const ucDir = path.join(dir, 'Use_Cases');
    for (const f of listDir(ucDir)) {
      if (f.isFile() && /\.docx$/i.test(f.name))
        comp.useCases.push(ucItem(path.join(ucDir, f.name), f.name));
      else if (f.isDirectory()) {
        for (const g of listDir(path.join(ucDir, f.name)))
          if (g.isFile() && /\.docx$/i.test(g.name))
            comp.withoutSolution.push(
              ucItem(path.join(ucDir, f.name, g.name), g.name)
            );
      }
    }
    comps.push(comp);
  }
  return comps.sort((a, b) => a.nr - b.nr);
}

// ---------------------------------------------------------------- the run

const publicUrl = (origin, bucket, p) =>
  `${origin}/storage/v1/object/public/${bucket}/${p.split('/').map(encodeURIComponent).join('/')}`;

export async function main(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.errors.length) {
    for (const e of args.errors) console.error(`Error: ${e}`);
    return 2;
  }
  const prepared = prepareConnection(
    { target: args.target, apply: args.apply, confirmHost: args.confirmHost },
    env
  );
  if (!prepared.ok) {
    prepared.messages.forEach(m => console.error(m));
    return prepared.status;
  }
  const origin = env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin
    : null;
  if (args.apply) {
    const problems = [
      ...checkStorageTarget('preview', env.NEXT_PUBLIC_SUPABASE_URL),
      ...checkConfirmStorageHost(
        args.confirmStorageHost,
        env.NEXT_PUBLIC_SUPABASE_URL
      ),
    ];
    if (!env.SUPABASE_SECRET_KEY)
      problems.push('SUPABASE_SECRET_KEY is not set.');
    if (problems.length) {
      problems.forEach(p => console.error(`Refused: ${p}`));
      return 1;
    }
  }
  const opened = await openVerifiedClient(prepared, args, 'fiae-documents');
  if (!opened.ok) {
    opened.messages.forEach(m =>
      console.error(redact(m, prepared.connectionString))
    );
    return opened.status;
  }
  const { client } = opened;
  opened.notes?.forEach(n => console.log(n));
  let exitCode = 0;
  try {
    exitCode =
      args.command === 'rollback'
        ? await rollback(args, client)
        : await execute(args, client, origin, env);
  } catch (error) {
    console.error(
      `Failed: ${redact(error?.message ?? error, prepared.connectionString)}`
    );
    exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
  return exitCode;
}

/**
 * Turns a run back with its report: the rows that were replaced get their old values again, the rows
 * that were added are removed. The files in the storage stay (nothing points to them any more).
 * Without --apply it only counts.
 */
async function rollback(args, client) {
  const log = JSON.parse(readFileSync(args.source, 'utf8'));
  const updated = log.updated ?? [];
  const inserted = log.inserted ?? [];
  console.log(
    `Report: ${updated.length} replaced rows to restore, ${inserted.length} added rows to remove.`
  );
  if (!args.apply) {
    console.log('Dry run: nothing was changed.');
    return 0;
  }
  await client.query('begin');
  try {
    for (const u of updated) {
      await client.query(
        `update public_preview.content_documents set file_name = $2, file_size = $3, storage_url = $4,
           storage_path = $5, page_count = $6, updated_at = now() where id = $1`,
        [
          u.id,
          u.old.file_name,
          u.old.file_size,
          u.old.storage_url,
          u.old.storage_path,
          u.old.page_count,
        ]
      );
    }
    if (inserted.length > 0) {
      await client.query(
        'delete from public_preview.content_documents where id = any($1::uuid[])',
        [inserted.map(x => x.id)]
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  console.log('Rolled back.');
  return 0;
}

async function execute(args, client, origin, env) {
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  const everything = readSource(args.source);
  const source = everything.filter(
    c =>
      !DEFERRED.has(c.key) &&
      (!args.components || args.components.includes(c.key))
  );
  const deferred = everything.filter(c => DEFERRED.has(c.key));
  const courses = await q(
    `select c.id, c.title from public_preview.courses c
       join public_preview.training_catalogs t on t.id = c.training_catalog_id where t.code = 'FIAE'`
  );
  const { map, problems } = mapComponents(everything, courses);
  if (problems.length) {
    problems.forEach(p => console.error(`Refused: ${p}`));
    return 1;
  }
  const courseIds = [...new Set([...map.values()].map(c => c.id))];
  const dbEnablers = await q(
    'select id, course_id, title, order_index from public_preview.enablers where course_id = any($1::uuid[]) order by order_index, title',
    [courseIds]
  );
  const docs = await q(
    `select id, enabler_id, use_case_id, title, document_type::text as document_type, storage_path, storage_url, file_name, file_size, page_count
       from public_preview.content_documents
      where enabler_id = any($1::uuid[]) or use_case_id in (select id from public_preview.use_cases where course_id = any($2::uuid[]))`,
    [dbEnablers.map(e => e.id), courseIds]
  );
  const useCases = await q(
    'select id, course_id, title from public_preview.use_cases where course_id = any($1::uuid[])',
    [courseIds]
  );

  const work = [];
  const gaps = {
    noEnabler: [],
    noUseCase: [],
    noMain: [],
    withoutSolutionFiles: [],
    deferred: deferred.map(d => d.title),
  };
  for (const comp of source) {
    const course = map.get(comp.nr);
    const enablers = dbEnablers.filter(e => e.course_id === course.id);
    const matched = matchEnablers(comp.enablers, enablers);
    comp.enablers.forEach((fe, i) => {
      const hit = matched.get(i);
      if (!hit) {
        gaps.noEnabler.push(`${comp.key} / ${fe.folder}`);
        return;
      }
      const e = hit.e;
      const base = `${PREFIX}k${comp.key}/e${fe.key}_${ascii(fe.title)}`;
      if (!fe.main) gaps.noMain.push(`${comp.key} / ${fe.folder}`);
      else {
        const row =
          docs.find(
            d => d.enabler_id === e.id && d.document_type === 'THEORY'
          ) ?? null;
        work.push({
          comp,
          kind: 'THEORY',
          label: `${comp.key}/${fe.key} Lehrtext`,
          title: row?.title ?? e.title,
          file: fe.main,
          bucket: CONTENT_BUCKET,
          path: `${base}.pdf`,
          row,
          enabler: e,
        });
      }
      for (const part of fe.parts) {
        const row =
          docs.find(
            d =>
              d.enabler_id === e.id &&
              d.document_type === 'EXERCISE' &&
              new RegExp(`Part\\s*${part.n}\\b`, 'i').test(d.title)
          ) ?? null;
        const title =
          row?.title ??
          `Szenario: Part ${part.n}: ${part.slug.replace(/_/g, ' ').trim()}`.slice(
            0,
            160
          );
        work.push({
          comp,
          kind: 'EXERCISE',
          label: `${comp.key}/${fe.key} Part ${part.n}`,
          title,
          file: part.file,
          bucket: CONTENT_BUCKET,
          path: `${base}/part${part.n}_${ascii(part.slug)}.pdf`,
          row,
          enabler: e,
          order: part.n,
        });
      }
    });
    // use case files -> use cases of the course (number and letter of the file name, or the letter alone
    // when only one use case of the course has it). Two files for one use case: none is taken.
    const matchUseCase = uc => {
      if (!uc.key) return null;
      const keyOf = u => {
        const mm = /(\d+)\s*([A-Za-z])\s*$/.exec(u.title);
        return mm ? `${Number(mm[1])}${mm[2].toUpperCase()}` : null;
      };
      const inCourse = useCases.filter(u => u.course_id === course.id);
      const exact = inCourse.filter(u => keyOf(u) === uc.key);
      if (exact.length === 1) return exact[0];
      if (exact.length > 1) return null;
      const letter = uc.key.replace(/^\d+/, '');
      const byLetter = inCourse.filter(
        u => (keyOf(u) ?? '').replace(/^\d+/, '') === letter
      );
      return byLetter.length === 1 ? byLetter[0] : null;
    };
    const hits = comp.useCases.map(uc => ({ uc, u: matchUseCase(uc) }));
    const perUseCase = new Map();
    hits.forEach(
      h => h.u && perUseCase.set(h.u.id, (perUseCase.get(h.u.id) ?? 0) + 1)
    );
    for (const { uc, u } of hits) {
      if (!u) {
        gaps.noUseCase.push(`${comp.key} / ${uc.name}`);
        continue;
      }
      if (perUseCase.get(u.id) > 1) {
        gaps.noUseCase.push(
          `${comp.key} / ${uc.name} (zwei Dateien für einen Use Case)`
        );
        continue;
      }
      const row =
        docs.find(
          d => d.use_case_id === u.id && d.document_type === 'TRAINER_SOLUTION'
        ) ?? null;
      work.push({
        comp,
        kind: 'TRAINER_SOLUTION',
        label: `${comp.key} ${uc.key} Lösung`,
        title: row?.title ?? `Use Case ${uc.key}: Musterlösung`,
        file: uc.file,
        bucket: SOLUTIONS_BUCKET,
        path: `${PREFIX}k${comp.key}/uc_${uc.key}.pdf`,
        row,
        useCase: u,
      });
    }
    comp.withoutSolution.forEach(x =>
      gaps.withoutSolutionFiles.push(`${comp.key} / ${x.name}`)
    );
  }
  const isDone = w => w.row && w.row.storage_path === w.path;
  const pending = work.filter(w => !isDone(w));
  const limited = args.limit ? pending.slice(0, args.limit) : pending;

  const count = list =>
    list.reduce((a, w) => ((a[w.kind] = (a[w.kind] ?? 0) + 1), a), {});
  console.log(
    `Components in scope: ${source.length} (deferred: ${deferred.length})`
  );
  console.log(
    `Files with a target: ${work.length} ${JSON.stringify(count(work))}`
  );
  console.log(
    `To write now: ${limited.length} ${JSON.stringify(count(limited))}, replace ${limited.filter(w => w.row).length}, add ${limited.filter(w => !w.row).length}, already done ${work.length - pending.length}`
  );
  console.log(
    `No enabler in the Preview: ${gaps.noEnabler.length}; no use case: ${gaps.noUseCase.length}; without main file: ${gaps.noMain.length}; use cases without solution (not uploaded): ${gaps.withoutSolutionFiles.length}`
  );
  gaps.noEnabler.forEach(x => console.log(`  - no enabler: ${x}`));
  gaps.noUseCase.forEach(x => console.log(`  - no use case: ${x}`));
  if (args.command === 'plan' || !args.apply) {
    console.log(
      args.command === 'plan'
        ? 'Plan only.'
        : 'Dry run: nothing was converted or stored.'
    );
    if (args.out)
      writeFileSync(
        args.out,
        JSON.stringify({ gaps, summary: count(limited) }, null, 1)
      );
    return 0;
  }

  const soffice = findSoffice(args.soffice, env);
  if (soffice.error) {
    console.error(`Refused: ${soffice.error}`);
    return 1;
  }
  const storage = createSupabaseStorage({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    key: env.SUPABASE_SECRET_KEY,
  });
  const workspace = createWorkspace('fiae-docs-');
  const converter = createLibreOfficeConverter({
    soffice: soffice.path,
    workspace,
    timeoutMs: 240000,
  });
  process.once('SIGINT', () => converter.abort());
  const log = { updated: [], inserted: [], stored: [], failed: [], gaps };
  let seq = 0;
  try {
    const byComp = new Map();
    limited.forEach(w =>
      byComp.set(w.comp.key, [...(byComp.get(w.comp.key) ?? []), w])
    );
    for (const [key, items] of byComp) {
      const ready = [];
      for (const w of items) {
        seq += 1;
        const inFile = path.join(workspace.inDir, `f${seq}.docx`);
        const outFile = path.join(workspace.finalDir, `f${seq}.pdf`);
        try {
          copyFileSync(w.file, inFile);
        } catch {
          log.failed.push({ label: w.label, why: 'SOURCE_UNREADABLE' });
          continue;
        }
        const result = await converter.convert(inFile, outFile);
        if (!result.ok) {
          log.failed.push({ label: w.label, why: `CONVERT_${result.code}` });
          continue;
        }
        const raw = readFileSync(outFile);
        if (raw.length === 0 || raw.subarray(0, 5).toString() !== '%PDF-') {
          log.failed.push({ label: w.label, why: 'NOT_A_PDF' });
          continue;
        }
        const cleaned = await cleanPdfMetadata(new Uint8Array(raw), w.title);
        if (cleaned.bytes.length > MAX_PDF_BYTES) {
          log.failed.push({ label: w.label, why: 'TOO_LARGE' });
          continue;
        }
        try {
          await storage.put(
            w.bucket,
            w.path,
            cleaned.bytes,
            'application/pdf',
            { upsert: true }
          );
        } catch (error) {
          log.failed.push({
            label: w.label,
            why: `STORE_${error?.code ?? 'ERROR'}`,
          });
          continue;
        }
        log.stored.push({
          bucket: w.bucket,
          path: w.path,
          sha: createHash('sha256')
            .update(cleaned.bytes)
            .digest('hex')
            .slice(0, 16),
        });
        ready.push({ w, size: cleaned.bytes.length, pages: cleaned.pageCount });
      }
      await client.query('begin');
      try {
        for (const { w, size, pages } of ready) {
          const url =
            w.bucket === SOLUTIONS_BUCKET
              ? `private://${w.bucket}/${w.path}`
              : publicUrl(origin, w.bucket, w.path);
          const fileName = path.posix.basename(w.path);
          if (w.row) {
            await client.query(
              `update public_preview.content_documents set file_name = $2, file_size = $3, mime_type = 'application/pdf',
                 storage_url = $4, storage_path = $5, page_count = $6, updated_at = now() where id = $1`,
              [w.row.id, fileName, size, url, w.path, pages]
            );
            log.updated.push({
              id: w.row.id,
              label: w.label,
              old: {
                file_name: w.row.file_name,
                file_size: w.row.file_size,
                storage_url: w.row.storage_url,
                storage_path: w.row.storage_path,
                page_count: w.row.page_count,
              },
            });
          } else {
            const ins = await client.query(
              `insert into public_preview.content_documents
                 (enabler_id, use_case_id, course_id, title, document_type, file_name, file_size, mime_type, storage_url, storage_path, order_index, uploaded_by_id, visibility, page_count)
               values ($1,$2,$3,$4,$5::public_preview.content_document_type,$6,$7,'application/pdf',$8,$9,$10,$11,$12::public_preview.document_visibility,$13)
               returning id`,
              [
                w.enabler?.id ?? null,
                w.useCase?.id ?? null,
                w.enabler?.course_id ?? w.useCase?.course_id ?? null,
                w.title,
                w.kind,
                fileName,
                size,
                url,
                w.path,
                w.order ?? 0,
                args.createdBy,
                w.kind === 'TRAINER_SOLUTION' ? 'TRAINER_ONLY' : 'ALL',
                pages,
              ]
            );
            log.inserted.push({ id: ins.rows[0].id, label: w.label });
          }
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
      console.log(
        `Component ${key}: ${ready.length} written of ${items.length}, failed so far ${log.failed.length}`
      );
    }
  } finally {
    workspace.cleanup();
    if (args.out) writeFileSync(args.out, JSON.stringify(log, null, 1));
  }
  console.log(
    `Done: ${log.updated.length} replaced, ${log.inserted.length} added, ${log.failed.length} failed.`
  );
  log.failed
    .slice(0, 20)
    .forEach(f => console.log(`  - failed: ${f.label} (${f.why})`));
  return log.failed.length ? 1 : 0;
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === 'fiae-documents.mjs'
) {
  main(process.argv.slice(2)).then(code => process.exit(code));
}
