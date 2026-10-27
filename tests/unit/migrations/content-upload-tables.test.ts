/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  contentUploadApplies,
  contentUploadAppliedRows,
  contentUploadDecisions,
  contentUploadFiles,
  contentUploadKiCalls,
  contentUploadProposals,
  contentUploadRuns,
} from '@/db/migrations/schemas/schema';
import { TABLES } from '@/lib/content-import/apply/tables';

/**
 * Static checks of 20261030000100_content_upload_tables.sql (package U1 of
 * docs/ki-upload-konzept.md): the seven staging and protocol tables of the
 * content upload. The behavior of the SQL (create, run twice, constraints,
 * rights, rollback) was run against throwaway local databases (see the pull
 * request); these tests guard the conventions of the release pipeline, the
 * shape of the tables of section 3.2 of the concept and the match between the
 * migration and the Drizzle schema.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261030000100_content_upload_tables.sql';
const ROLLBACK = path.join(
  process.cwd(),
  'supabase',
  'manual',
  'rollback-content-upload-tables.sql'
);
const MAX_IDENTIFIER_LENGTH = 63;

const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf-8');
const header = raw
  .split(/\r?\n/)
  .filter(line => line.startsWith('--'))
  .map(line => line.replace(/^--\s?/, ''))
  .join(' ')
  .replace(/\s+/g, ' ');
/** SQL without line comments (the file documents itself in comments). */
const sql = raw
  .split(/\r?\n/)
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');
/** SQL without comments and with string literals blanked: statements only. */
const statements = sql.replace(/'(?:[^']|'')*'/g, "''");

const allFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

/** The seven tables with their columns: name:type:n (not null) or o (optional). */
const EXPECTED: Record<string, string[]> = {
  content_upload_runs: [
    'id:uuid:n',
    'training_catalog_id:uuid:n',
    'created_by_id:uuid:n',
    'label:text:n',
    'status:text:n',
    'ki_enabled:boolean:n',
    'declaration_accepted_at:timestamptz:n',
    'storage_prefix:text:n',
    'decisions_version:integer:n',
    'last_dry_run_hash:text:o',
    'created_at:timestamptz:n',
    'updated_at:timestamptz:n',
    'finished_at:timestamptz:o',
    'purge_after:timestamptz:o',
  ],
  content_upload_files: [
    'id:uuid:n',
    'run_id:uuid:n',
    'rel_path:text:n',
    'file_name:text:n',
    'ext:text:n',
    'size_bytes:bigint:n',
    'sha256:text:n',
    'client_mtime_ms:bigint:o',
    'storage_path:text:n',
    'status:text:n',
    'status_code:text:o',
    'attempts:integer:n',
    'locked_until:timestamptz:o',
    'claim_id:uuid:o',
    'duplicate_of_id:uuid:o',
    'similar_group:text:o',
    'doc_type:text:o',
    'page_count:integer:o',
    'char_count:integer:o',
    'parse_summary:jsonb:o',
    'dup_key:text:o',
    'created_at:timestamptz:n',
    'completed_at:timestamptz:o',
    'processed_at:timestamptz:o',
  ],
  content_upload_proposals: [
    'id:uuid:n',
    'file_id:uuid:n',
    'source:text:n',
    'doc_type:text:o',
    'component_code:text:o',
    'enabler_code:text:o',
    'quiz_level:text:o',
    'confidence:numeric(3,2):n',
    'band:text:n',
    'reasons:jsonb:n',
    'model:text:o',
    'is_current:boolean:n',
    'created_at:timestamptz:n',
  ],
  content_upload_decisions: [
    'id:uuid:n',
    'run_id:uuid:n',
    'file_id:uuid:n',
    'proposal_id:uuid:o',
    'decisions_version:integer:n',
    'decided_by_id:uuid:n',
    'action:text:n',
    'doc_type:text:o',
    'component_code:text:o',
    'enabler_code:text:o',
    'quiz_level:text:o',
    'dup_choice:text:o',
    'note:text:o',
    'is_current:boolean:n',
    'decided_at:timestamptz:n',
  ],
  content_upload_ki_calls: [
    'id:uuid:n',
    'run_id:uuid:n',
    'file_id:uuid:n',
    'requested_at:timestamptz:n',
    'stage:text:n',
    'model:text:o',
    'endpoint_host:text:o',
    'excerpt:text:o',
    'excerpt_chars:integer:n',
    'excerpt_sha256:text:n',
    'redactions:integer:n',
    'status:text:n',
    'http_status:integer:o',
    'latency_ms:integer:o',
    'prompt_tokens:integer:o',
    'completion_tokens:integer:o',
    'attempt:integer:n',
    'answer_excerpt:text:o',
  ],
  content_upload_applies: [
    'id:uuid:n',
    'run_id:uuid:n',
    'mode:text:n',
    'started_by_id:uuid:n',
    'decisions_version:integer:n',
    'decisions_hash:text:n',
    'update_existing:boolean:n',
    'status:text:n',
    'target_schema:text:n',
    'counts:jsonb:n',
    'conflicts:jsonb:n',
    'started_at:timestamptz:n',
    'finished_at:timestamptz:o',
  ],
  content_upload_applied_rows: [
    'id:uuid:n',
    'apply_id:uuid:n',
    'table_name:text:n',
    'row_id:uuid:n',
    'action:text:n',
    'before:jsonb:o',
    'file_id:uuid:o',
  ],
};

/** Foreign keys: name -> [column, referenced table, on delete]. */
const EXPECTED_FOREIGN_KEYS: Record<string, Record<string, string[]>> = {
  content_upload_runs: {
    content_upload_runs_training_catalog_id_fk: [
      'training_catalog_id',
      'training_catalogs',
      'restrict',
    ],
    content_upload_runs_created_by_id_fk: [
      'created_by_id',
      'profiles',
      'restrict',
    ],
  },
  content_upload_files: {
    content_upload_files_run_id_fk: [
      'run_id',
      'content_upload_runs',
      'cascade',
    ],
    content_upload_files_duplicate_of_id_fk: [
      'duplicate_of_id',
      'content_upload_files',
      'set null',
    ],
  },
  content_upload_proposals: {
    content_upload_proposals_file_id_fk: [
      'file_id',
      'content_upload_files',
      'cascade',
    ],
  },
  content_upload_decisions: {
    content_upload_decisions_run_id_fk: [
      'run_id',
      'content_upload_runs',
      'cascade',
    ],
    content_upload_decisions_file_id_fk: [
      'file_id',
      'content_upload_files',
      'cascade',
    ],
    content_upload_decisions_proposal_id_fk: [
      'proposal_id',
      'content_upload_proposals',
      'set null',
    ],
    content_upload_decisions_decided_by_id_fk: [
      'decided_by_id',
      'profiles',
      'restrict',
    ],
  },
  content_upload_ki_calls: {
    content_upload_ki_calls_run_id_fk: [
      'run_id',
      'content_upload_runs',
      'cascade',
    ],
    content_upload_ki_calls_file_id_fk: [
      'file_id',
      'content_upload_files',
      'cascade',
    ],
  },
  content_upload_applies: {
    content_upload_applies_run_id_fk: [
      'run_id',
      'content_upload_runs',
      'restrict',
    ],
    content_upload_applies_started_by_id_fk: [
      'started_by_id',
      'profiles',
      'restrict',
    ],
  },
  content_upload_applied_rows: {
    content_upload_applied_rows_apply_id_fk: [
      'apply_id',
      'content_upload_applies',
      'cascade',
    ],
    content_upload_applied_rows_file_id_fk: [
      'file_id',
      'content_upload_files',
      'set null',
    ],
  },
};

const RUN_STATUSES = [
  'draft',
  'uploading',
  'processing',
  'review',
  'applying',
  'applied',
  'failed',
  'discarded',
];
const FILE_STATUSES = [
  'announced',
  'uploaded',
  'verified',
  'extracted',
  'proposed_rules',
  'unclear',
  'ki_pending',
  'proposed_ki',
  'decided',
  'applied',
  'failed',
  'rejected',
  'expired',
  'merged',
  'skipped',
  'superseded',
];
const DOC_TYPES = [
  'enabler',
  'quiz',
  'global_quiz',
  'scenario',
  'use_case',
  'pdf_original',
  'other',
];

// --- a small reader for the create table statements -------------------------

/** The text between the parenthesis at `open` and its partner (quotes respected). */
function balanced(text: string, open: number): string {
  let depth = 0;
  let quote = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'") quote = !quote;
    if (quote) continue;
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced parenthesis');
}

/** Splits at the commas outside of parentheses and quotes. */
function splitTop(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let current = '';
  for (const c of body) {
    if (c === "'") quote = !quote;
    if (!quote) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && depth === 0) {
        out.push(current.trim());
        current = '';
        continue;
      }
    }
    current += c;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

interface ParsedTable {
  columns: Record<string, { type: string; notNull: boolean; rest: string }>;
  constraints: Record<string, { kind: string; text: string }>;
}

function parseTables(): Record<string, ParsedTable> {
  const tables: Record<string, ParsedTable> = {};
  const pattern = /create table if not exists public\.([a-z_]+)\s*\(/gi;
  for (const match of sql.matchAll(pattern)) {
    const open = match.index! + match[0].length - 1;
    const parsed: ParsedTable = { columns: {}, constraints: {} };
    for (const item of splitTop(balanced(sql, open))) {
      const constraint = /^constraint\s+([a-z0-9_]+)\s+([\s\S]+)$/i.exec(item);
      if (constraint) {
        const text = constraint[2].replace(/\s+/g, ' ');
        const kind = /^(primary key|foreign key|unique|check)/i
          .exec(text)![1]
          .toLowerCase();
        parsed.constraints[constraint[1]] = { kind, text };
        continue;
      }
      const column =
        /^([a-z_][a-z0-9_]*)\s+(uuid|text|integer|bigint|boolean|timestamptz|jsonb|numeric\(\d+,\s*\d+\))([\s\S]*)$/i.exec(
          item
        );
      if (!column) throw new Error(`cannot read: ${item}`);
      parsed.columns[column[1]] = {
        type: column[2].toLowerCase().replace(/\s+/g, ''),
        notNull: /\bnot null\b/i.test(column[3]),
        rest: column[3].replace(/\s+/g, ' ').trim(),
      };
    }
    tables[match[1]] = parsed;
  }
  return tables;
}

interface ParsedIndex {
  unique: boolean;
  table: string;
  columns: string;
  where: string | null;
}

function parseIndexes(): Record<string, ParsedIndex> {
  const indexes: Record<string, ParsedIndex> = {};
  const pattern =
    /create\s+(unique\s+)?index\s+if\s+not\s+exists\s+([a-z0-9_]+)\s+on\s+public\.([a-z_]+)\s*\(([^)]*)\)\s*(?:where\s+([^;]+))?;/gi;
  for (const match of sql.matchAll(pattern)) {
    indexes[match[2]] = {
      unique: Boolean(match[1]),
      table: match[3],
      columns: match[4].replace(/\s+/g, ' ').trim(),
      where: match[5] ? match[5].replace(/\s+/g, ' ').trim() : null,
    };
  }
  return indexes;
}

const parsed = parseTables();
const indexes = parseIndexes();
const tableNames = Object.keys(EXPECTED);

/** The list of values in `check (<column> in ('a', 'b'))` of a constraint. */
function valuesOf(table: string, constraint: string): string[] {
  const text = parsed[table].constraints[constraint].text;
  return [...text.matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]);
}

// --- tests ------------------------------------------------------------------

describe('content upload migration: place in the series', () => {
  it('has a 14 digit version and a lowercase name', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it('is the next version behind the lockdown of the API roles and is part of the series', () => {
    expect(FILE > '20261029000300_security_revoke_api_table_access.sql').toBe(
      true
    );
    expect(allFiles).toContain(FILE);
  });

  it('is held back in Production by the rollout gate (version above GATED_FROM)', () => {
    const gate = fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'db', 'rollout-gate.mjs'),
      'utf-8'
    );
    const gatedFrom = /GATED_FROM = '(\d{14})'/.exec(gate)?.[1] ?? '';
    expect(gatedFrom).toMatch(/^\d{14}$/);
    expect(FILE.slice(0, 14) >= gatedFrom).toBe(true);
  });
});

describe('content upload migration: conventions', () => {
  it('has no explicit transaction control', () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it('keeps the lock and statement timeouts of the series', () => {
    expect(sql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
  });

  it('installs no extensions, roles, publications, policies, functions or triggers', () => {
    expect(statements).not.toMatch(
      /\b(create|alter|drop)\s+(extension|role|user|publication|policy)\b/i
    );
    expect(statements).not.toMatch(
      /\b(create|alter)\s+(or\s+replace\s+)?(function|trigger|type|view|sequence)\b/i
    );
  });

  it('qualifies every table with public. and never names the Preview schema', () => {
    const unqualified = [
      ...statements.matchAll(
        /\b(?:table|on|references)\s+(?:if\s+not\s+exists\s+)?(?!public\.|if\s)(content_upload_[a-z_]+|training_catalogs|profiles)\b/gi
      ),
    ];
    expect(unqualified).toEqual([]);
    // comments may explain the Preview, statements must not name its schema
    expect(sql).not.toMatch(/public_preview/);
    expect(sql).not.toMatch(/'public'/);
  });

  it('documents purpose, effect, closed access, rollout and undo in the header', () => {
    expect(header).toMatch(/content upload/i);
    expect(header).toMatch(/docs\/ki-upload-konzept\.md/);
    expect(header).toMatch(/no policy/i);
    expect(header).toMatch(/Safe to run twice/i);
    expect(header).toMatch(/rollout gate/i);
    expect(header).toMatch(/Production/);
    expect(header).toMatch(/Undo/i);
    expect(header).toMatch(/rollback-content-upload-tables\.sql/);
    for (const name of tableNames) {
      expect(header).toContain(name);
    }
  });

  it('keeps every identifier within the 63 character limit', () => {
    const names = [
      ...tableNames,
      ...Object.keys(indexes),
      ...Object.values(parsed).flatMap(t => Object.keys(t.constraints)),
    ];
    expect(names.filter(name => name.length > MAX_IDENTIFIER_LENGTH)).toEqual(
      []
    );
  });

  it('uses no catalog lookup that the Preview rewrite cannot place', () => {
    expect(sql).not.toMatch(/table_schema\s*=\s*'public'/i);
    expect(sql).not.toMatch(/schemaname\s*=\s*'public'/i);
    expect(sql).not.toMatch(/nspname\s*=\s*'public'/i);
  });
});

describe('content upload migration: the seven tables', () => {
  it('creates exactly the seven tables, idempotently, and nothing else', () => {
    expect(Object.keys(parsed).sort()).toEqual([...tableNames].sort());
    expect(statements.match(/create\s+table/gi)).toHaveLength(7);
    expect(
      statements.match(/create\s+table\s+if\s+not\s+exists/gi)
    ).toHaveLength(7);
  });

  it.each(tableNames)(
    '%s has the columns of section 3.2 of the concept',
    table => {
      const expected = EXPECTED[table].map(entry => {
        const [name, type, flag] = entry.split(':');
        return { name, type, notNull: flag === 'n' };
      });
      const actual = Object.entries(parsed[table].columns).map(([name, c]) => ({
        name,
        type: c.type,
        notNull: c.notNull,
      }));
      expect(actual).toEqual(expected);
    }
  );

  it.each(tableNames)(
    '%s has a uuid primary key with a generated default',
    table => {
      expect(parsed[table].columns.id.rest).toMatch(
        /default gen_random_uuid\(\)/
      );
      expect(parsed[table].constraints[`${table}_pkey`]?.text).toMatch(
        /^primary key \(id\)$/
      );
    }
  );

  it.each(tableNames)(
    '%s has the foreign keys and delete rules of the concept',
    table => {
      const actual: Record<string, string[]> = {};
      for (const [name, c] of Object.entries(parsed[table].constraints)) {
        if (c.kind !== 'foreign key') continue;
        const m =
          /^foreign key \((\w+)\) references public\.(\w+) \(id\)(?: on delete (restrict|cascade|set null))?$/i.exec(
            c.text
          );
        expect(m).not.toBeNull();
        actual[name] = [m![1], m![2], (m![3] ?? 'no action').toLowerCase()];
      }
      expect(actual).toEqual(EXPECTED_FOREIGN_KEYS[table] ?? {});
    }
  );

  it('gives every uuid column ending in _id a foreign key, except row_id and claim_id', () => {
    const missing: string[] = [];
    for (const table of tableNames) {
      const fkColumns = Object.values(EXPECTED_FOREIGN_KEYS[table] ?? {}).map(
        v => v[0]
      );
      for (const column of Object.keys(parsed[table].columns)) {
        if (!column.endsWith('_id') || column === 'id') continue;
        if (['row_id', 'claim_id'].includes(column)) continue;
        if (!fkColumns.includes(column)) missing.push(`${table}.${column}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('defaults the statuses and counters of the state machines', () => {
    expect(parsed.content_upload_runs.columns.status.rest).toMatch(
      /default 'draft'/
    );
    expect(parsed.content_upload_runs.columns.ki_enabled.rest).toMatch(
      /default true/
    );
    expect(parsed.content_upload_runs.columns.decisions_version.rest).toMatch(
      /default 0/
    );
    expect(parsed.content_upload_files.columns.status.rest).toMatch(
      /default 'announced'/
    );
    expect(parsed.content_upload_files.columns.attempts.rest).toMatch(
      /default 0/
    );
    expect(parsed.content_upload_applies.columns.status.rest).toMatch(
      /default 'running'/
    );
    expect(parsed.content_upload_applies.columns.update_existing.rest).toMatch(
      /default false/
    );
    for (const table of [
      'content_upload_proposals',
      'content_upload_decisions',
    ]) {
      expect(parsed[table].columns.is_current.rest).toMatch(/default true/);
    }
  });

  it('keeps the status values of section 2.3 of the concept', () => {
    expect(
      valuesOf('content_upload_runs', 'content_upload_runs_status_check')
    ).toEqual(RUN_STATUSES);
    expect(
      valuesOf('content_upload_files', 'content_upload_files_status_check')
    ).toEqual(FILE_STATUSES);
    expect(
      valuesOf('content_upload_files', 'content_upload_files_doc_type_check')
    ).toEqual(DOC_TYPES);
    expect(
      valuesOf(
        'content_upload_proposals',
        'content_upload_proposals_doc_type_check'
      )
    ).toEqual(DOC_TYPES);
    expect(
      valuesOf(
        'content_upload_decisions',
        'content_upload_decisions_doc_type_check'
      )
    ).toEqual(DOC_TYPES);
    expect(
      valuesOf('content_upload_files', 'content_upload_files_ext_check')
    ).toEqual(['docx', 'pdf']);
  });

  it('keeps the values of proposals, decisions and the protocols', () => {
    expect(
      valuesOf(
        'content_upload_proposals',
        'content_upload_proposals_source_check'
      )
    ).toEqual(['path', 'content', 'path_content', 'ki']);
    expect(
      valuesOf(
        'content_upload_proposals',
        'content_upload_proposals_band_check'
      )
    ).toEqual(['high', 'medium', 'low', 'conflict']);
    for (const [table, name] of [
      ['content_upload_proposals', 'content_upload_proposals_quiz_level_check'],
      ['content_upload_decisions', 'content_upload_decisions_quiz_level_check'],
    ]) {
      expect(valuesOf(table, name)).toEqual(['low', 'medium', 'high']);
    }
    expect(
      valuesOf(
        'content_upload_decisions',
        'content_upload_decisions_action_check'
      )
    ).toEqual(['accept', 'reject', 'defer']);
    expect(
      valuesOf(
        'content_upload_decisions',
        'content_upload_decisions_dup_choice_check'
      )
    ).toEqual(['keep', 'skip']);
    expect(
      valuesOf('content_upload_ki_calls', 'content_upload_ki_calls_stage_check')
    ).toEqual(['type_component', 'enabler']);
    expect(
      valuesOf(
        'content_upload_ki_calls',
        'content_upload_ki_calls_status_check'
      )
    ).toEqual([
      'ok',
      'invalid_json',
      'not_in_whitelist',
      'timeout',
      'http_error',
      'refused_by_guard',
      'skipped',
    ]);
    expect(
      valuesOf('content_upload_applies', 'content_upload_applies_mode_check')
    ).toEqual(['dry_run', 'apply']);
    expect(
      valuesOf('content_upload_applies', 'content_upload_applies_status_check')
    ).toEqual(['running', 'ok', 'conflict', 'failed']);
    // the Preview rewrite forbids a literal 'public' and the Preview schema
    // name in a migration, so the two target schemas are one pattern
    expect(
      parsed.content_upload_applies.constraints
        .content_upload_applies_target_schema_check.text
    ).toBe("check (target_schema ~ '^public(_preview)?$')");
    expect(
      valuesOf(
        'content_upload_applied_rows',
        'content_upload_applied_rows_action_check'
      )
    ).toEqual(['insert', 'update']);
  });

  it('limits the rows of the protocol of applied rows to the tables of the apply step', () => {
    const listed = valuesOf(
      'content_upload_applied_rows',
      'content_upload_applied_rows_table_name_check'
    );
    expect(listed.slice().sort()).toEqual(Object.keys(TABLES).sort());
  });

  it('bounds the text columns of the concept', () => {
    const checks = (table: string) =>
      Object.values(parsed[table].constraints)
        .map(c => c.text)
        .join(' ');
    expect(checks('content_upload_runs')).toMatch(
      /char_length\(label\) between 1 and 120/
    );
    expect(checks('content_upload_files')).toMatch(
      /char_length\(rel_path\) between 1 and 500/
    );
    expect(checks('content_upload_files')).toMatch(
      /char_length\(file_name\) between 1 and 200/
    );
    expect(checks('content_upload_decisions')).toMatch(
      /char_length\(note\) <= 500/
    );
    expect(checks('content_upload_ki_calls')).toMatch(
      /char_length\(answer_excerpt\) <= 500/
    );
  });

  it('holds sha256 values as 64 lowercase hex characters', () => {
    expect(
      parsed.content_upload_files.constraints.content_upload_files_sha256_check
        .text
    ).toMatch(/sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(
      parsed.content_upload_ki_calls.constraints
        .content_upload_ki_calls_excerpt_sha256_check.text
    ).toMatch(/excerpt_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
  });

  it('never lets the model be the only source of a sure proposal (cap 0.80, never high)', () => {
    const text =
      parsed.content_upload_proposals.constraints
        .content_upload_proposals_ki_limits_check.text;
    expect(text).toMatch(/source <> 'ki'/);
    expect(text).toMatch(/confidence <= 0\.80/);
    expect(text).toMatch(/band in \('medium', 'low'\)/);
    expect(
      parsed.content_upload_proposals.constraints
        .content_upload_proposals_confidence_check.text
    ).toMatch(/confidence between 0 and 1/);
  });

  it('requires a document type for an accepted decision', () => {
    expect(
      parsed.content_upload_decisions.constraints
        .content_upload_decisions_accept_values_check.text
    ).toMatch(/action <> 'accept' or doc_type is not null/);
  });

  it('lets a file never be a duplicate of itself', () => {
    expect(
      parsed.content_upload_files.constraints
        .content_upload_files_not_self_duplicate_check.text
    ).toMatch(/duplicate_of_id is null or duplicate_of_id <> id/);
  });

  it('keeps the protocol of a transmission free of keys, headers and file contents', () => {
    const columns = Object.keys(parsed.content_upload_ki_calls.columns);
    for (const column of columns) {
      expect(column).not.toMatch(
        /key|secret|password|authorization|header|bearer|url|path|file_name|content/i
      );
    }
    // the transmitted excerpt is bounded and may be wiped later (30 days)
    expect(parsed.content_upload_ki_calls.columns.excerpt.notNull).toBe(false);
    expect(
      parsed.content_upload_ki_calls.constraints
        .content_upload_ki_calls_excerpt_check.text
    ).toMatch(/char_length\(excerpt\) <= \d+/);
    // only the host, never a path or credentials
    const host =
      parsed.content_upload_ki_calls.constraints
        .content_upload_ki_calls_endpoint_host_check.text;
    expect(host).toMatch(/endpoint_host ~ '\^\[a-z0-9\.-\]\+/);
    expect(host).not.toMatch(/\//);
  });

  it('keeps the snapshot of an update in the protocol of applied rows only for updates', () => {
    expect(
      parsed.content_upload_applied_rows.constraints
        .content_upload_applied_rows_before_check.text
    ).toMatch(
      /action = 'insert' and before is null\) or \(action = 'update' and before is not null/
    );
  });

  it('carries no foreign key to the content tables (row_id points at several tables)', () => {
    const references = Object.values(parsed)
      .flatMap(t => Object.values(t.constraints))
      .filter(c => c.kind === 'foreign key')
      .map(c => /references public\.(\w+)/.exec(c.text)![1]);
    for (const target of references) {
      expect([
        'training_catalogs',
        'profiles',
        'content_upload_runs',
        'content_upload_files',
        'content_upload_proposals',
        'content_upload_applies',
      ]).toContain(target);
    }
  });

  it('is unique per run, path and hash, per storage path and per applied row', () => {
    const unique = (table: string) =>
      Object.fromEntries(
        Object.entries(parsed[table].constraints)
          .filter(([, c]) => c.kind === 'unique')
          .map(([name, c]) => [name, c.text])
      );
    expect(unique('content_upload_files')).toEqual({
      content_upload_files_run_path_hash_key:
        'unique (run_id, rel_path, sha256)',
      content_upload_files_storage_path_key: 'unique (storage_path)',
    });
    expect(unique('content_upload_runs')).toEqual({
      content_upload_runs_storage_prefix_key: 'unique (storage_prefix)',
    });
    expect(unique('content_upload_applied_rows')).toEqual({
      content_upload_applied_rows_row_key:
        'unique (apply_id, table_name, row_id)',
    });
  });
});

describe('content upload migration: indexes', () => {
  const expected: Record<string, [string, string, boolean, string | null]> = {
    content_upload_runs_status_idx: [
      'content_upload_runs',
      'status',
      false,
      null,
    ],
    content_upload_runs_created_by_idx: [
      'content_upload_runs',
      'created_by_id, created_at desc',
      false,
      null,
    ],
    content_upload_files_queue_idx: [
      'content_upload_files',
      'run_id, status, locked_until',
      false,
      null,
    ],
    content_upload_files_run_dup_key_idx: [
      'content_upload_files',
      'run_id, dup_key',
      false,
      null,
    ],
    content_upload_files_sha256_idx: [
      'content_upload_files',
      'sha256',
      false,
      null,
    ],
    content_upload_files_duplicate_of_idx: [
      'content_upload_files',
      'duplicate_of_id',
      false,
      null,
    ],
    content_upload_proposals_current_uidx: [
      'content_upload_proposals',
      'file_id',
      true,
      'is_current',
    ],
    content_upload_proposals_file_idx: [
      'content_upload_proposals',
      'file_id, created_at desc',
      false,
      null,
    ],
    content_upload_decisions_current_uidx: [
      'content_upload_decisions',
      'file_id',
      true,
      'is_current',
    ],
    content_upload_decisions_run_idx: [
      'content_upload_decisions',
      'run_id',
      false,
      null,
    ],
    content_upload_decisions_file_idx: [
      'content_upload_decisions',
      'file_id, decided_at desc',
      false,
      null,
    ],
    content_upload_decisions_proposal_idx: [
      'content_upload_decisions',
      'proposal_id',
      false,
      'proposal_id is not null',
    ],
    content_upload_ki_calls_run_idx: [
      'content_upload_ki_calls',
      'run_id',
      false,
      null,
    ],
    content_upload_ki_calls_file_idx: [
      'content_upload_ki_calls',
      'file_id',
      false,
      null,
    ],
    content_upload_applies_run_idx: [
      'content_upload_applies',
      'run_id, started_at desc',
      false,
      null,
    ],
    content_upload_applies_running_uidx: [
      'content_upload_applies',
      'run_id',
      true,
      "status = 'running'",
    ],
    content_upload_applied_rows_table_row_idx: [
      'content_upload_applied_rows',
      'table_name, row_id',
      false,
      null,
    ],
  };

  it('has the indexes of section 3.2 of the concept, all idempotent', () => {
    const actual = Object.fromEntries(
      Object.entries(indexes).map(([name, i]) => [
        name,
        [i.table, i.columns, i.unique, i.where],
      ])
    );
    expect(actual).toEqual(expected);
    expect(statements.match(/create\s+(unique\s+)?index/gi)).toHaveLength(
      Object.keys(expected).length
    );
    expect(statements).not.toMatch(
      /create\s+(unique\s+)?index\s+(?!if not exists)/i
    );
  });

  it('allows one current proposal and one current decision per file and one running apply per run', () => {
    expect(indexes.content_upload_proposals_current_uidx.unique).toBe(true);
    expect(indexes.content_upload_decisions_current_uidx.unique).toBe(true);
    expect(indexes.content_upload_applies_running_uidx.unique).toBe(true);
  });
});

describe('content upload migration: closed for the API roles', () => {
  const blocks = [...sql.matchAll(/do\s+\$\$[\s\S]*?\$\$\s*;/gi)].map(
    m => m[0]
  );

  it('enables row level security on every table and adds no policy', () => {
    for (const table of tableNames) {
      expect(statements).toMatch(
        new RegExp(
          `alter table public\\.${table} enable row level security\\s*;`,
          'i'
        )
      );
    }
    expect(statements.match(/enable row level security/gi)).toHaveLength(7);
    expect(statements).not.toMatch(/\bcreate\s+policy\b/i);
    expect(statements).not.toMatch(/force row level security/i);
  });

  it('revokes every privilege of anon and authenticated from the seven tables, only if the roles exist', () => {
    const revoke = blocks.find(b => /revoke all on public\.%I/i.test(b));
    expect(revoke).toBeDefined();
    expect(revoke).toMatch(/array\['anon', 'authenticated'\]/);
    expect(revoke).toMatch(/pg_roles/);
    for (const table of tableNames) {
      expect(revoke).toContain(`'${table}'`);
    }
    expect(revoke).toMatch(/revoke all on public\.%I from %I/);
  });

  it('checks at the end that the API roles hold no privilege and stops otherwise', () => {
    const check = blocks.find(b => /has_any_column_privilege/i.test(b));
    expect(check).toBeDefined();
    expect(check).toMatch(/raise exception/i);
    expect(check).toMatch(/pg_roles/);
    expect(check).toMatch(/array\['anon', 'authenticated'\]/);
    for (const table of tableNames) {
      expect(check).toContain(`'${table}'`);
    }
  });

  it('grants nothing (the server connection owns the tables or holds the default privileges)', () => {
    expect(statements).not.toMatch(/\bgrant\b/i);
  });
});

describe('content upload migration: touches nothing else', () => {
  it('changes no existing table and no data and drops nothing', () => {
    expect(statements).not.toMatch(
      /\balter\s+table\s+(?!public\.content_upload_)/i
    );
    expect(statements).not.toMatch(
      /\b(insert\s+into|update\s+public|delete\s+from|truncate|merge|copy)\b/i
    );
    expect(statements).not.toMatch(/\bdrop\b/i);
    expect(statements).not.toMatch(
      /\balter\s+table[^;]*\b(add|drop)\s+column/i
    );
  });

  it('keeps the tables out of the content sync (process data, never copied between schemas)', () => {
    const list = fs.readFileSync(
      path.join(process.cwd(), 'supabase', 'content-tables.json'),
      'utf-8'
    );
    expect(list).not.toMatch(/content_upload/);
  });
});

describe('content upload rollback template', () => {
  const rollbackRaw = fs.readFileSync(ROLLBACK, 'utf-8');
  const rollback = rollbackRaw
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  it('runs in one transaction and takes a lock timeout', () => {
    expect(rollback).toMatch(/^\s*begin\s*;/im);
    expect(rollback).toMatch(/^\s*commit\s*;/im);
    expect(rollback).toMatch(/set\s+local\s+lock_timeout/i);
  });

  it('refuses to drop tables that hold rows unless the switch is set explicitly', () => {
    expect(rollback).toMatch(/raise exception/i);
    expect(rollback).toMatch(/content_upload\.rollback_allow_data/);
    for (const table of tableNames) {
      expect(rollback).toContain(table);
    }
  });

  it('drops only the seven tables, children first, without cascade into other tables', () => {
    const drops = [...rollback.matchAll(/drop table if exists public\.(\w+)/gi)]
      .map(m => m[1])
      .filter(name => name.startsWith('content_upload_'));
    expect(drops).toEqual([
      'content_upload_applied_rows',
      'content_upload_applies',
      'content_upload_ki_calls',
      'content_upload_decisions',
      'content_upload_proposals',
      'content_upload_files',
      'content_upload_runs',
    ]);
    expect(rollback).not.toMatch(/\bcascade\b/i);
    expect(rollback.match(/\bdrop\s+table\b/gi)).toHaveLength(7);
    expect(rollback).not.toMatch(/\b(delete\s+from|truncate)\b/i);
  });

  it('explains how to try it first and what it does not remove (bucket objects)', () => {
    expect(rollbackRaw).toMatch(/rollback;/);
    expect(rollbackRaw).toMatch(/content-upload/);
    expect(rollbackRaw).toMatch(/supabase_migrations/);
  });
});

describe('Drizzle schema of the content upload tables', () => {
  const drizzle: Record<string, PgTable> = {
    content_upload_runs: contentUploadRuns,
    content_upload_files: contentUploadFiles,
    content_upload_proposals: contentUploadProposals,
    content_upload_decisions: contentUploadDecisions,
    content_upload_ki_calls: contentUploadKiCalls,
    content_upload_applies: contentUploadApplies,
    content_upload_applied_rows: contentUploadAppliedRows,
  };
  const sqlType = (type: string) =>
    type.replace('timestamp with time zone', 'timestamptz').replace(/\s+/g, '');

  it.each(tableNames)(
    '%s has the columns, types and null rules of the migration',
    table => {
      const config = getTableConfig(drizzle[table]);
      expect(config.name).toBe(table);
      expect(
        config.columns.map(c => ({
          name: c.name,
          type: sqlType(c.getSQLType()),
          notNull: c.notNull,
        }))
      ).toEqual(
        Object.entries(parsed[table].columns).map(([name, c]) => ({
          name,
          type: c.type,
          notNull: c.notNull,
        }))
      );
    }
  );

  it.each(tableNames)('%s has the same defaults as the migration', table => {
    const config = getTableConfig(drizzle[table]);
    for (const column of config.columns) {
      const declared = parsed[table].columns[column.name].rest;
      const hasDefault = /\bdefault\b/i.test(declared);
      expect(`${column.name}:${column.hasDefault}`).toBe(
        `${column.name}:${hasDefault}`
      );
    }
  });

  it.each(tableNames)(
    '%s declares the foreign keys with the names and delete rules of the migration',
    table => {
      const config = getTableConfig(drizzle[table]);
      const actual = Object.fromEntries(
        config.foreignKeys.map(fk => {
          const ref = fk.reference();
          return [
            fk.getName(),
            [
              ref.columns.map(c => c.name).join(','),
              getTableConfig(ref.foreignTable).name,
              fk.onDelete ?? 'no action',
            ],
          ];
        })
      );
      expect(actual).toEqual(EXPECTED_FOREIGN_KEYS[table] ?? {});
    }
  );

  it.each(tableNames)(
    '%s declares the checks, unique constraints and indexes of the migration',
    table => {
      const config = getTableConfig(drizzle[table]);
      const constraintsOf = (kind: string) =>
        Object.entries(parsed[table].constraints)
          .filter(([, c]) => c.kind === kind)
          .map(([name]) => name)
          .sort();
      expect(config.checks.map(c => c.name).sort()).toEqual(
        constraintsOf('check')
      );
      expect(config.uniqueConstraints.map(u => u.name).sort()).toEqual(
        constraintsOf('unique')
      );
      expect(config.indexes.map(i => i.config.name).sort()).toEqual(
        Object.entries(indexes)
          .filter(([, i]) => i.table === table)
          .map(([name]) => name)
          .sort()
      );
      for (const index of config.indexes) {
        expect(index.config.unique).toBe(indexes[index.config.name!].unique);
      }
    }
  );

  it('keeps the primary key of every table on the id column', () => {
    for (const table of tableNames) {
      const config = getTableConfig(drizzle[table]);
      const id = config.columns.find(c => c.name === 'id')!;
      expect(id.primary).toBe(true);
      expect(config.primaryKeys).toEqual([]);
    }
  });
});
