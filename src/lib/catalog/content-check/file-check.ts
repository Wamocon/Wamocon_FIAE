/**
 * Check of the storage for the documents of ONE catalog, on request: does the file that a
 * document names exist in the bucket `content`?
 *
 * A check of every file on every run would be far too heavy for a page of the admin, so
 * this takes a random sample of at most FILE_CHECK_SAMPLE documents per run and asks the
 * storage for the existence of each object (a HEAD request, the file is NEVER loaded).
 * A document whose file is missing is a finding of the severity `error`, rule
 * `document.storage.missing` (the rule `document.file.missing` of the script checks is
 * another case: a document that names no file and has no text at all).
 *
 * Read only, nothing is stored, no file content and no stored address leaves this module:
 * the finding names the title of the document, never the path.
 */

import { sql } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { withDbRetry } from '@/lib/db-retry';
import { getSupabaseSecretKey } from '@/lib/env';
import type { SnapshotExecutor } from '@/lib/catalog/content-check/snapshot';
import type { Finding, FindingRef } from '@/lib/catalog/content-check/types';
import {
  CONTENT_BUCKET,
  parseContentReference,
} from '@/lib/storage/contentPath';

/** Most documents asked per run. */
export const FILE_CHECK_SAMPLE = 50;
/** Existence questions at the same time. */
export const FILE_CHECK_CONCURRENCY = 5;
/** No new question is started after this time (the route allows 60 seconds). */
export const FILE_CHECK_TIME_MS = 30_000;
/** Most documents named in the finding (the count of all missing is in the details). */
const MAX_REFS = 20;

/** What the check needs from the storage: existence by path, `unknown` when it cannot tell. */
export interface FileExistence {
  exists(path: string): Promise<boolean | 'unknown'>;
}

export interface FileCheckDeps {
  /** Replaces the storage client. Only the tests pass it. */
  storage?: () => FileExistence | null;
  /** The Supabase url of this deployment, for the form of the stored address. */
  supabaseUrl?: string | null;
  /** Replaces the sample size. Only the tests pass it. */
  sample?: number;
  now?: () => number;
  timeLimitMs?: number;
}

export interface DocumentFileCheckResult {
  catalogId: string;
  catalogCode: string;
  /** ISO time of the run. */
  generatedAt: string;
  /** Documents of the catalog with a stored address. */
  totalWithFile: number;
  /** Documents drawn for this run. */
  sampleSize: number;
  /** Documents the storage answered for (present or missing). */
  checked: number;
  /** Of those, the ones whose file is missing. */
  missing: number;
  /** Documents the storage could not answer for (error of the storage, unusable path). */
  unknown: number;
  /** Documents whose address is no object of the bucket (an external link). */
  external: number;
  /** Documents not asked because the time limit was reached. */
  notChecked: number;
  durationMs: number;
  findings: Finding[];
  /** German, short. */
  notes: string[];
}

type Row = Record<string, unknown>;

/** The storage with the secret key (the key stays on the server). Null without a key. */
function defaultStorage(): FileExistence | null {
  const url =
    process.env.SUPABASE_URL_INTERNAL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const key = getSupabaseSecretKey();
  if (!url || !key) return null;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async exists(path: string) {
      try {
        const { data, error } = await client.storage
          .from(CONTENT_BUCKET)
          .exists(path);
        if (error) return 'unknown';
        return data === true;
      } catch {
        return 'unknown';
      }
    },
  };
}

/** Runs `worker` over `items`, at most `limit` at the same time, and stops starting new ones at `until`. */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  stop: () => boolean,
  worker: (item: T) => Promise<void>
): Promise<number> {
  let next = 0;
  let started = 0;
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length && !stop()) {
        const i = next++;
        started += 1;
        await worker(items[i]);
      }
    }
  );
  await Promise.all(lanes);
  return started;
}

/**
 * Checks a random sample of the documents of a catalog against the storage. Returns null
 * when the catalog does not exist. Never throws for an expected failure: a storage that
 * cannot answer is counted as `unknown` and said in `notes`.
 */
export async function checkDocumentFiles(
  q: SnapshotExecutor,
  catalogId: string,
  deps: FileCheckDeps = {}
): Promise<DocumentFileCheckResult | null> {
  const now = deps.now ?? Date.now;
  const started = now();
  const id = sql`${catalogId}::uuid`;
  const run = async (statement: ReturnType<typeof sql>): Promise<Row[]> =>
    (await withDbRetry(() => q.execute(statement))) as unknown as Row[];

  const catalogRows = await run(sql`
    /* cc:file_catalog */
    select c.code from training_catalogs c where c.id = ${id}
  `);
  if (catalogRows.length === 0) return null;
  const catalogCode =
    typeof catalogRows[0].code === 'string' ? catalogRows[0].code : '';

  const size = Math.max(
    1,
    Math.min(deps.sample ?? FILE_CHECK_SAMPLE, FILE_CHECK_SAMPLE)
  );
  // The same documents as the snapshot reads: platform documents of this catalog
  const rows = await run(sql`
    /* cc:file_sample */
    select d.id, d.title, d.storage_url, (count(*) over ())::int as total
    from content_documents d
    where d.organization_id is null
      and nullif(btrim(d.storage_url), '') is not null
      and (
        d.enabler_id in (
          select x.id from enablers x where x.training_catalog_id = ${id})
        or d.use_case_id in (
          select x.id from use_cases x where x.training_catalog_id = ${id})
        or d.course_id in (
          select x.id from courses x where x.training_catalog_id = ${id})
      )
    order by random()
    limit ${size}
  `);

  const result: DocumentFileCheckResult = {
    catalogId,
    catalogCode,
    generatedAt: new Date(started).toISOString(),
    totalWithFile: rows.length > 0 ? Number(rows[0].total) : 0,
    sampleSize: rows.length,
    checked: 0,
    missing: 0,
    unknown: 0,
    external: 0,
    notChecked: 0,
    durationMs: 0,
    findings: [],
    notes: [],
  };
  const finish = (): DocumentFileCheckResult => {
    result.durationMs = now() - started;
    return result;
  };
  if (rows.length === 0) return finish();

  let storage: FileExistence | null;
  try {
    storage = (deps.storage ?? defaultStorage)();
  } catch {
    storage = null;
  }
  if (!storage) {
    result.unknown = rows.length;
    result.notes.push(
      'Der Zugriff auf den Speicher ist in dieser Umgebung nicht eingerichtet, es wurde keine Datei geprüft.'
    );
    return finish();
  }

  const limitMs = deps.timeLimitMs ?? FILE_CHECK_TIME_MS;
  const missingRefs: FindingRef[] = [];
  const asked = await eachLimited(
    rows,
    FILE_CHECK_CONCURRENCY,
    () => now() - started > limitMs,
    async row => {
      const ref = parseContentReference(row.storage_url, {
        supabaseUrl: deps.supabaseUrl,
      });
      if (ref.kind === 'other') {
        result.external += 1;
        return;
      }
      if (ref.kind === 'invalid') {
        // an unsafe path is never asked: the file cannot be opened from this address
        result.unknown += 1;
        return;
      }
      const answer = await storage.exists(ref.path);
      if (answer === 'unknown') {
        result.unknown += 1;
        return;
      }
      result.checked += 1;
      if (answer === false) {
        result.missing += 1;
        const title = typeof row.title === 'string' ? row.title.trim() : '';
        missingRefs.push({
          type: 'document',
          id: String(row.id),
          label:
            title.length > 80
              ? `${title.slice(0, 79)}…`
              : title || String(row.id),
        });
      }
    }
  );
  result.notChecked = rows.length - asked;

  if (result.notChecked > 0) {
    result.notes.push(
      `Zeitlimit erreicht: ${result.notChecked} von ${rows.length} Dokumenten der Stichprobe wurden nicht mehr geprüft.`
    );
  }
  if (result.unknown > 0) {
    result.notes.push(
      `Bei ${result.unknown} Dokumenten konnte der Speicher keine Antwort geben (Fehler des Speichers oder ungültige Adresse), sie zählen weder als vorhanden noch als fehlend.`
    );
  }
  if (result.external > 0) {
    result.notes.push(
      `${result.external} Dokumente verweisen auf eine Adresse außerhalb des Speichers (zum Beispiel einen Link) und wurden nicht geprüft.`
    );
  }

  if (missingRefs.length > 0) {
    const shown = missingRefs.slice(0, MAX_REFS);
    result.findings.push({
      rule: 'document.storage.missing',
      severity: 'error',
      source: 'script',
      category: 'document',
      summary:
        missingRefs.length === 1
          ? '1 Dokument hat keine Datei im Speicher.'
          : `${missingRefs.length} Dokumente haben keine Datei im Speicher.`,
      details: `Stichprobe: ${result.checked} von ${result.totalWithFile} Dokumenten mit Datei geprüft. Betroffen: ${missingRefs.length}${
        missingRefs.length > shown.length
          ? `, genannt: die ersten ${shown.length}`
          : ''
      }.`,
      refs: shown,
      hint: 'Die Datei erneut hochladen oder das Dokument löschen. Eine Stichprobe kann weitere fehlende Dateien übersehen, der Lauf des Skripts content:hash listet alle.',
    });
  }
  return finish();
}
