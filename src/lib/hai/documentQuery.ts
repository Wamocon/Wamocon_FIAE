/**
 * Questions about files ("Welche Dateien hat dieser Enabler?", "Wie heißt die
 * Datei zu Use Case 3?", "Was steht in Datenbank_Grundlagen.pdf?").
 *
 * The answer comes from the database (content_documents), not from vector hits:
 * the files of the enabler, use case or course that the page shows (page
 * context) or that the question names (title), plus a file name in the message
 * (case insensitive, underscore, hyphen or space as separator, extension
 * optional) against the files the person may see.
 *
 * Access (the rules of the PageIndex, documentAccessCondition):
 *  - occupation: only files of an enabler, use case or course in an occupation
 *    of the person (a file without such a link is visible to nobody)
 *  - organization: own organization and platform files (NULL)
 *  - trainees never get a file of the type TRAINER_SOLUTION or the visibility
 *    TRAINER_ONLY: not its name and not the fact that it exists (also not in a
 *    count). The rows are filtered once more in code behind the SQL.
 *  - a file that does not exist and a file the person may not see get the same
 *    neutral answer (like denial.ts, no difference between "not there" and "not
 *    allowed")
 *
 * @module lib/hai/documentQuery
 */

import haiDb from '@/db/haiDb';
import { sql, type SQL } from 'drizzle-orm';
import { foldText } from './navigation/fold';
import { isPageUuid as isUuid } from './pageContext/shared';
import {
  isMetadataAllowedForTrainingScope,
  type HaiTrainingScope,
} from './trainingScope';
import { documentAccessCondition } from './documentAccessSql';
import { FILE_EXTENSIONS } from './pageContext/shared';

/** Most lines of a file list. */
export const DOCUMENT_LIST_MAX = 20;
/** Most rows read from the database before the code filters them. */
const DOCUMENT_ROWS_MAX = 200;

/** Heading of every answer of this module (the tests and the prompt read it). */
export const DOCUMENT_LIST_MARKER = '**Dateien:**';

// ============================================================================
// RECOGNITION (pure, folded umlauts)
// ============================================================================

const DOCUMENT_WORDS =
  /\b(?:datei(?:en|name|namen)?|dokument(?:e|en|s)?|anhang|anhaenge|anhaengen|unterlage|unterlagen|pdfs?|handouts?)\b/;
const FILE_EXTENSION_IN_TEXT = new RegExp(
  `\\.(?:${FILE_EXTENSIONS.join('|')})\\b`,
  'i'
);
/** Questions about submissions are the submission intent, not the files of the content. */
const SUBMISSION_WORDS =
  /\b(?:abgabe|abgaben|abgeben|abgegeben|eingereicht|einreichung|einreichen)\b/;

/**
 * A question about files: file names or lists ("welche Dateien", "Anhang",
 * "Unterlagen", PDF, an extension like .docx, a file name in the message, "wie
 * heißt die Datei"). Reads the folded text, so spoken text without capitals or
 * umlauts counts as well.
 */
export function isDocumentQuestion(message: string): boolean {
  const folded = foldText(message);
  if (SUBMISSION_WORDS.test(folded)) return false;
  return DOCUMENT_WORDS.test(folded) || FILE_EXTENSION_IN_TEXT.test(message);
}

/** "diese Datei", "das PDF": the message points at one file of the page. */
const DEMONSTRATIVE_FILE =
  /\b(?:diese|dieses|dieser|die|das|der)\s+(?:datei|dokument|pdf|anhang)\b/;

export function pointsAtOneFile(message: string): boolean {
  return DEMONSTRATIVE_FILE.test(foldText(message));
}

const STOPWORDS = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einen',
  'einem',
  'einer',
  'von',
  'vom',
  'zu',
  'zum',
  'zur',
  'im',
  'in',
  'am',
  'an',
  'auf',
  'aus',
  'bei',
  'mit',
  'fuer',
  'ueber',
  'und',
  'oder',
  'hat',
  'ist',
  'sind',
  'gibt',
  'es',
  'mir',
  'mich',
  'wie',
  'was',
  'wer',
  'welche',
  'welcher',
  'welches',
  'welchen',
  'heisst',
  'heissen',
  'steht',
  'stehen',
  'zeig',
  'zeige',
  'nenne',
  'bitte',
  'diese',
  'dieses',
  'dieser',
  'datei',
  'dateien',
  'dokument',
  'dokumente',
  'anhang',
  'unterlagen',
  'unterlage',
  'pdf',
  'pdfs',
  'enabler',
  'use',
  'case',
  'kurs',
  'alle',
  'meine',
  'gehoert',
  'gehoeren',
  'dazu',
  'hier',
  'noch',
]);

/**
 * The comparison form of a file name or title: umlauts folded, lower case,
 * extension cut off, underscore, hyphen, dots and spaces as one space. The SQL
 * below builds the same form, so "Datenbank_Grundlagen.pdf", "datenbank
 * grundlagen" and "Datenbank-Grundlagen" are one key.
 */
export function normalizeFileKey(name: string): string {
  const withoutExtension = name
    .trim()
    .replace(new RegExp(`\\.(?:${FILE_EXTENSIONS.join('|')})$`, 'i'), '');
  return foldText(withoutExtension.replace(/[_\-.]+/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** All contiguous phrases of 1 to 6 words, longest first, without stop words at the edges. */
function phrasesOf(text: string): string[] {
  const words = normalizeFileKey(text).split(' ').filter(Boolean);
  const phrases: string[] = [];
  for (let start = 0; start < words.length; start++) {
    for (let end = Math.min(words.length, start + 6); end > start; end--) {
      const slice = words.slice(start, end);
      if (STOPWORDS.has(slice[0]) || STOPWORDS.has(slice[slice.length - 1])) {
        continue;
      }
      const phrase = slice.join(' ');
      if (phrase.length >= 4) phrases.push(phrase);
    }
  }
  return [...new Set(phrases)].sort((a, b) => b.length - a.length);
}

const WORD = '[\\p{L}\\p{N}_\\-]+';
const EXT_NAME_RE = new RegExp(
  `(${WORD}(?: ${WORD}){0,5})\\.(?:${FILE_EXTENSIONS.join('|')})\\b`,
  'giu'
);
const QUOTED_RE = /["„“”'«»‚‘’]([^"„“”'«»‚‘’]{3,80})["„“”'«»‚‘’]/gu;
const BEFORE_KEYWORD_RE = new RegExp(
  `(${WORD}(?: ${WORD}){0,3}) (?:pdf|datei|dokument)\\b`,
  'giu'
);
const AFTER_KEYWORD_RE = new RegExp(
  `\\b(?:datei|dokument|pdf|anhang|unterlage)\\s+(${WORD}(?: ${WORD}){0,3})`,
  'giu'
);

/**
 * Comparison keys for a file name in the message, longest first. Sources: a
 * name with an extension (the extension is optional for the match), a quoted
 * text, and the words after "Datei", "Dokument", "PDF" when they look like a
 * name (several words, or a word with underscore, hyphen or digit). A key that
 * is only a stop word or shorter than 4 characters is dropped.
 */
export function extractFileNameKeys(message: string): FileNameKey[] {
  const found = new Map<string, boolean>();
  const add = (raw: string) => {
    // the longest phrase of a source may match a file name in part, the
    // shorter ones (parts of the same words) only a file that has exactly that name
    phrasesOf(raw).forEach((key, index) => {
      if (!found.has(key) || (index === 0 && !found.get(key))) {
        found.set(key, index === 0);
      }
    });
  };
  for (const m of message.matchAll(EXT_NAME_RE)) add(m[1]);
  for (const m of message.matchAll(QUOTED_RE)) add(m[1]);
  for (const m of message.matchAll(AFTER_KEYWORD_RE)) {
    const raw = m[1];
    const looksLikeName =
      /[_\-0-9]/.test(raw) ||
      normalizeFileKey(raw)
        .split(' ')
        .filter(w => w && !STOPWORDS.has(w)).length >= 2;
    if (looksLikeName) add(raw);
  }
  // spoken: the name before the noun ("datenbank grundlagen pdf")
  for (const m of message.matchAll(BEFORE_KEYWORD_RE)) {
    const raw = m[1];
    const words = normalizeFileKey(raw)
      .split(' ')
      .filter(w => w && !STOPWORDS.has(w));
    if (words.length >= 2) add(raw);
  }
  return [...found.entries()]
    .map(([key, partial]) => ({ key, partial }))
    .sort((a, b) => b.key.length - a.key.length)
    .slice(0, 12);
}

/** A comparison key and whether a file name may contain it (else it must be equal). */
export interface FileNameKey {
  key: string;
  partial: boolean;
}

// ============================================================================
// ROWS, ACCESS AND FORMAT
// ============================================================================

export interface DocumentRow {
  id: string;
  title: string | null;
  fileName: string;
  mimeType: string | null;
  documentType: string | null;
  visibility: string | null;
  enablerId: string | null;
  enablerTitle: string | null;
  useCaseId: string | null;
  useCaseTitle: string | null;
  courseId: string | null;
  courseTitle: string | null;
  /** For the training scope filter (course year of the enabler, use case years and stages). */
  courseYear: number | null;
  useCaseYears: number[] | null;
  useCaseStages: number[] | null;
}

/** What a person may read (from the session and the database, never from the message). */
export interface DocumentAccess {
  catalogIds: string[];
  audience: 'trainee' | 'trainer';
  organizationId?: string | null;
  trainingScope?: HaiTrainingScope;
}

/** The records the page shows or the question names. */
export interface DocumentScope {
  enablerIds: string[];
  useCaseIds: string[];
  courseIds: string[];
}

export interface DocumentAnswer {
  /** The block for the prompt (data context). */
  text: string;
  /** Files whose pages the PageIndex loads (a named file, or the one file of the page). */
  documentIds: string[];
  /** Number of files the person may see for this question. */
  total: number;
}

/** The same neutral answer for "does not exist" and "not allowed". */
export function documentNotFoundText(requestedName?: string | null): string {
  const named = requestedName
    ? ` zu "${requestedName.replace(/["\n\r]/g, '').slice(0, 80)}"`
    : '';
  return `${DOCUMENT_LIST_MARKER} Ich finde${named} keine passende Datei in deinen freigegebenen Inhalten. Nenne mir bitte den Namen genauer oder frage nach den Dateien eines Enablers, Use Cases oder Kurses. Rate keine Dateinamen.`;
}

/** Type of a file for the list: from the extension, else the mime type. */
export function fileTypeOf(fileName: string, mimeType?: string | null): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(fileName ?? '');
  if (match) return match[1].toUpperCase();
  if (mimeType) return mimeType.split('/').pop()?.toUpperCase() ?? 'Datei';
  return 'Datei';
}

/**
 * Second line of defense behind the SQL: a trainee never gets a solution or a
 * trainer-only file, whatever the query returned; everybody gets the training
 * scope of the person applied.
 */
export function filterDocumentRows(
  rows: DocumentRow[],
  access: Pick<DocumentAccess, 'audience' | 'trainingScope'>
): DocumentRow[] {
  return rows.filter(row => {
    if (
      access.audience !== 'trainer' &&
      (row.documentType === 'TRAINER_SOLUTION' ||
        row.visibility === 'TRAINER_ONLY')
    ) {
      return false;
    }
    if (row.enablerId && row.courseYear !== null) {
      if (
        !isMetadataAllowedForTrainingScope(
          { year: row.courseYear },
          'course',
          access.trainingScope
        )
      ) {
        return false;
      }
    }
    if (row.useCaseId) {
      if (
        !isMetadataAllowedForTrainingScope(
          {
            year: row.useCaseYears,
            trainingStage: row.useCaseStages,
          } as Record<string, unknown>,
          'use_case',
          access.trainingScope
        )
      ) {
        return false;
      }
    }
    return true;
  });
}

function belongsTo(row: DocumentRow): string {
  if (row.enablerTitle) return `Enabler "${row.enablerTitle}"`;
  if (row.useCaseTitle) return `Use Case "${row.useCaseTitle}"`;
  if (row.courseTitle) return `Kurs "${row.courseTitle}"`;
  return 'ohne Zuordnung';
}

/** Keep one-line text: no line breaks, no markup. */
function oneLine(text: string, max = 120): string {
  return text
    .replace(/[\r\n|*`#<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** The list for the prompt: title, file name, type, the enabler or use case, at most 20 lines. */
export function formatDocumentList(rows: DocumentRow[], total: number): string {
  const shown = rows.slice(0, DOCUMENT_LIST_MAX);
  const head =
    total > shown.length
      ? `${DOCUMENT_LIST_MARKER} ${total} Dateien gefunden, die ersten ${shown.length} stehen hier. Frage nach einem Enabler, Use Case oder Kurs, um die Liste einzugrenzen.`
      : `${DOCUMENT_LIST_MARKER} ${total} ${total === 1 ? 'Datei' : 'Dateien'} gefunden.`;
  const lines = [
    head,
    'Quelle: Datenbank der Plattform, nur Dateien, die du sehen darfst. Nenne nur Dateien aus dieser Liste.',
  ];
  for (const row of shown) {
    lines.push(
      `- ${oneLine(row.title || row.fileName)} | Datei: ${oneLine(row.fileName)} | Typ: ${fileTypeOf(row.fileName, row.mimeType)} | gehört zu: ${oneLine(belongsTo(row))}`
    );
  }
  return lines.join('\n');
}

/**
 * The options of the data context for a question about files: the access from
 * the retrieval access of the turn (null without one: fail closed, the answer
 * is neutral) and the records of the page (ids already checked).
 */
export function documentOptionsFor(
  access:
    | {
        catalogIds: string[];
        audience: 'trainee' | 'trainer';
        organizationId?: string | null;
      }
    | null
    | undefined,
  trainingScope: HaiTrainingScope | undefined,
  entities: Array<{ type: string; id: string }>
): { documentAccess: DocumentAccess | null; page: DocumentScope } {
  const idsOf = (type: string) =>
    entities.filter(e => e.type === type).map(e => e.id);
  return {
    documentAccess: access
      ? {
          catalogIds: access.catalogIds,
          audience: access.audience,
          organizationId: access.organizationId,
          trainingScope,
        }
      : null,
    page: {
      enablerIds: idsOf('enabler'),
      useCaseIds: idsOf('use_case'),
      courseIds: idsOf('course'),
    },
  };
}

// ============================================================================
// DATABASE
// ============================================================================

/** SQL form of normalizeFileKey for a column (same folding, same separators). */
function normalizedColumn(column: string): SQL {
  return sql.raw(
    `trim(regexp_replace(replace(replace(replace(replace(lower(regexp_replace(${column}, '\\.(${FILE_EXTENSIONS.join('|')})$', '', 'i')), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'), '[_.[:space:]-]+', ' ', 'g'))`
  );
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, c => `\\${c}`);
}

function uuidList(ids: string[]): SQL {
  return sql.join(
    ids.filter(isUuid).map(id => sql`${id}::uuid`),
    sql`, `
  );
}

const SELECT_DOCUMENTS = sql`
  SELECT cd.id, cd.title, cd.file_name, cd.mime_type, cd.document_type, cd.visibility,
         cd.enabler_id, e.title AS enabler_title,
         cd.use_case_id, uc.title AS use_case_title,
         cd.course_id, co.title AS course_title,
         ec.year AS course_year, uc.year AS use_case_years, uc.training_stage AS use_case_stages
  FROM content_documents cd
  LEFT JOIN enablers e ON cd.enabler_id = e.id
  LEFT JOIN courses ec ON e.course_id = ec.id
  LEFT JOIN use_cases uc ON cd.use_case_id = uc.id
  LEFT JOIN courses co ON cd.course_id = co.id
`;

function toRow(r: any): DocumentRow {
  return {
    id: String(r.id),
    title: r.title ?? null,
    fileName: String(r.file_name ?? ''),
    mimeType: r.mime_type ?? null,
    documentType: r.document_type ?? null,
    visibility: r.visibility ?? null,
    enablerId: r.enabler_id ? String(r.enabler_id) : null,
    enablerTitle: r.enabler_title ?? null,
    useCaseId: r.use_case_id ? String(r.use_case_id) : null,
    useCaseTitle: r.use_case_title ?? null,
    courseId: r.course_id ? String(r.course_id) : null,
    courseTitle: r.course_title ?? null,
    courseYear: r.course_year != null ? Number(r.course_year) : null,
    useCaseYears: Array.isArray(r.use_case_years)
      ? r.use_case_years.map(Number)
      : null,
    useCaseStages: Array.isArray(r.use_case_stages)
      ? r.use_case_stages.map(Number)
      : null,
  };
}

/**
 * The condition that every row must meet: the occupation of every linked record
 * is one of the person, a file without a link matches nobody (fail closed), and
 * the access of documentAccessCondition (organization, trainer-only files).
 */
function accessWhere(access: DocumentAccess, catalogIds: string[]): SQL {
  const catalogs = uuidList(catalogIds);
  return sql`
    (cd.enabler_id IS NOT NULL OR cd.use_case_id IS NOT NULL OR cd.course_id IS NOT NULL)
    AND (cd.enabler_id IS NULL OR e.training_catalog_id IN (${catalogs}))
    AND (cd.use_case_id IS NULL OR uc.training_catalog_id IN (${catalogs}))
    AND (cd.course_id IS NULL OR co.training_catalog_id IN (${catalogs}))
    AND ${documentAccessCondition(access)}
  `;
}

/** Files of the given records (enabler, use case, course and what hangs below a course). */
export async function queryDocumentsByScope(
  access: DocumentAccess,
  scope: DocumentScope
): Promise<DocumentRow[]> {
  const catalogIds = [...new Set((access.catalogIds ?? []).filter(isUuid))];
  if (catalogIds.length === 0) return [];
  const parts: SQL[] = [];
  if (scope.enablerIds.some(isUuid)) {
    parts.push(sql`cd.enabler_id IN (${uuidList(scope.enablerIds)})`);
  }
  if (scope.useCaseIds.some(isUuid)) {
    parts.push(sql`cd.use_case_id IN (${uuidList(scope.useCaseIds)})`);
  }
  if (scope.courseIds.some(isUuid)) {
    const courses = uuidList(scope.courseIds);
    parts.push(sql`cd.course_id IN (${courses})`);
    parts.push(sql`e.course_id IN (${courses})`);
    parts.push(sql`uc.course_id IN (${courses})`);
  }
  if (parts.length === 0) return [];
  const result = await haiDb.execute(sql`
    ${SELECT_DOCUMENTS}
    WHERE (${sql.join(parts, sql` OR `)})
      AND ${accessWhere(access, catalogIds)}
    ORDER BY cd.order_index, cd.title
    LIMIT ${DOCUMENT_ROWS_MAX}
  `);
  return (result as any[]).map(toRow);
}

/** Files whose name or title contains one of the keys (keys come from normalizeFileKey). */
export async function queryDocumentsByName(
  access: DocumentAccess,
  keys: string[]
): Promise<DocumentRow[]> {
  const catalogIds = [...new Set((access.catalogIds ?? []).filter(isUuid))];
  if (catalogIds.length === 0 || keys.length === 0) return [];
  const fileName = normalizedColumn('cd.file_name');
  const title = normalizedColumn("coalesce(cd.title, '')");
  const likes = keys.slice(0, 12).flatMap(key => {
    const pattern = `%${escapeLike(key)}%`;
    return [sql`${fileName} LIKE ${pattern}`, sql`${title} LIKE ${pattern}`];
  });
  const result = await haiDb.execute(sql`
    ${SELECT_DOCUMENTS}
    WHERE (${sql.join(likes, sql` OR `)})
      AND ${accessWhere(access, catalogIds)}
    ORDER BY cd.order_index, cd.title
    LIMIT ${DOCUMENT_ROWS_MAX}
  `);
  return (result as any[]).map(toRow);
}

/** All files the person may see (a question without a page and without a name). */
export async function queryAllDocuments(
  access: DocumentAccess
): Promise<DocumentRow[]> {
  const catalogIds = [...new Set((access.catalogIds ?? []).filter(isUuid))];
  if (catalogIds.length === 0) return [];
  const result = await haiDb.execute(sql`
    ${SELECT_DOCUMENTS}
    WHERE ${accessWhere(access, catalogIds)}
    ORDER BY cd.order_index, cd.title
    LIMIT ${DOCUMENT_ROWS_MAX}
  `);
  return (result as any[]).map(toRow);
}

export interface NamedRecord {
  type: 'enabler' | 'use_case' | 'course';
  id: string;
  title: string;
}

/**
 * The enabler, use case or course that the question names by its title (the
 * longest title that occurs in the message, whole words, folded). Only records
 * of the occupations of the person.
 */
export async function findNamedRecords(
  message: string,
  access: Pick<DocumentAccess, 'catalogIds'>
): Promise<NamedRecord[]> {
  const catalogIds = [...new Set((access.catalogIds ?? []).filter(isUuid))];
  if (catalogIds.length === 0) return [];
  const catalogs = uuidList(catalogIds);
  const result = await haiDb.execute(sql`
    SELECT 'enabler' AS type, id, title FROM enablers WHERE training_catalog_id IN (${catalogs})
    UNION ALL
    SELECT 'use_case' AS type, id, title FROM use_cases WHERE training_catalog_id IN (${catalogs})
    UNION ALL
    SELECT 'course' AS type, id, title FROM courses WHERE training_catalog_id IN (${catalogs})
  `);
  return matchNamedRecords(message, result as any[]);
}

/** Pure part of findNamedRecords: the longest titles that occur in the message. */
export function matchNamedRecords(
  message: string,
  records: Array<{ type: string; id: unknown; title: unknown }>
): NamedRecord[] {
  const haystack = ` ${normalizeFileKey(message)} `;
  const hits: Array<NamedRecord & { length: number }> = [];
  for (const r of records) {
    if (typeof r.title !== 'string') continue;
    const key = normalizeFileKey(r.title);
    if (key.length < 4) continue;
    if (haystack.includes(` ${key} `)) {
      hits.push({
        type: r.type as NamedRecord['type'],
        id: String(r.id),
        title: r.title,
        length: key.length,
      });
    }
  }
  if (hits.length === 0) return [];
  const longest = Math.max(...hits.map(h => h.length));
  return hits
    .filter(h => h.length === longest)
    .slice(0, 5)
    .map(({ length: _length, ...rest }) => rest);
}

// ============================================================================
// THE ANSWER
// ============================================================================

export interface DocumentQueryInput {
  message: string;
  access: DocumentAccess | null | undefined;
  /** Records of the page (checked against the access rules by the page context). */
  page?: DocumentScope | null;
}

/**
 * The answer to a question about files: the block for the prompt and the files
 * whose pages the PageIndex loads. Fail closed without an access.
 */
export async function answerDocumentQuestion(
  input: DocumentQueryInput
): Promise<DocumentAnswer> {
  const { message, access } = input;
  if (!access || (access.catalogIds ?? []).length === 0) {
    return { text: documentNotFoundText(), documentIds: [], total: 0 };
  }

  const keys = extractFileNameKeys(message);
  let rows: DocumentRow[] = [];
  let named = false;

  // 1. A file name in the message: exact or partial match against what the
  // person may see; only the rows of the longest matching key count
  if (keys.length > 0) {
    const candidates = filterDocumentRows(
      await queryDocumentsByName(
        access,
        keys.map(k => k.key)
      ),
      access
    );
    for (const { key, partial } of keys) {
      const names = (row: DocumentRow) => [
        normalizeFileKey(row.fileName),
        normalizeFileKey(row.title ?? ''),
      ];
      const matched = candidates.filter(row =>
        names(row).some(n => (partial ? n.includes(key) : n === key))
      );
      if (matched.length > 0) {
        const exact = matched.filter(
          row =>
            normalizeFileKey(row.fileName) === key ||
            normalizeFileKey(row.title ?? '') === key
        );
        rows = exact.length > 0 ? exact : matched;
        named = true;
        break;
      }
    }
    if (!named) {
      return {
        text: documentNotFoundText(keys[0].key),
        documentIds: [],
        total: 0,
      };
    }
  }

  // 2. The enabler, use case or course of the question (title), else of the page
  if (!named) {
    const recordsNamed = await findNamedRecords(message, access);
    const scope: DocumentScope =
      recordsNamed.length > 0
        ? {
            enablerIds: recordsNamed
              .filter(r => r.type === 'enabler')
              .map(r => r.id),
            useCaseIds: recordsNamed
              .filter(r => r.type === 'use_case')
              .map(r => r.id),
            courseIds: recordsNamed
              .filter(r => r.type === 'course')
              .map(r => r.id),
          }
        : (input.page ?? { enablerIds: [], useCaseIds: [], courseIds: [] });
    const hasScope =
      scope.enablerIds.length +
        scope.useCaseIds.length +
        scope.courseIds.length >
      0;
    rows = filterDocumentRows(
      hasScope
        ? await queryDocumentsByScope(access, scope)
        : await queryAllDocuments(access),
      access
    );
  }

  if (rows.length === 0) {
    return {
      text: documentNotFoundText(named ? keys[0].key : null),
      documentIds: [],
      total: 0,
    };
  }

  const isPdf = (row: DocumentRow) =>
    /pdf/i.test(row.mimeType ?? '') || /\.pdf$/i.test(row.fileName);
  // the pages of a named file (at most three) or of the one file the message points at
  const documentIds =
    named || (rows.length === 1 && pointsAtOneFile(message))
      ? rows
          .filter(isPdf)
          .slice(0, 3)
          .map(row => row.id)
      : [];

  return {
    text: formatDocumentList(rows, rows.length),
    documentIds,
    total: rows.length,
  };
}
