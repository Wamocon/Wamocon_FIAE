// Rewrites a migration for the schema public_preview (pure logic, no database).
//
// Why: Production and Preview share one Supabase database. Preview works in the
// schema public_preview, a structural copy of public. Every migration therefore
// runs a second time, rewritten, on public_preview, and it does so BEFORE the
// review and before public. Migrations refer to public explicitly
// (public.table, set search_path = public); without rewriting, Preview
// functions would write into Production.
//
// SECURITY MODEL. The rewrite is a convenience and an early warning, NOT the
// security boundary. The boundary is the database role app_preview_migrator
// (supabase/preview-setup/01-preview-role.sql): it owns public_preview and has
// no rights on public, auth, storage or any other schema. Unreviewed branch SQL
// runs as that role. The rules below still reject everything that could reach
// outside of public_preview, so that a mistake fails early with a readable
// message instead of a permission error, and so that a missing grant is not the
// only line of defence. Rejected (see FORBIDDEN): triggers and policies on
// auth.* and storage.*, any write (insert, update, delete, truncate, lock,
// merge, copy) on a table of another schema than public, DDL on shared schemas,
// drop/alter/create schema, drop owned, functions of auth/storage that are not
// read-only helpers, foreign keys to tables of other schemas, create extension
// into public, roles, publications, cron. Qualifications are normalised first,
// so spaces around the dot, quoted identifiers and comments between the parts
// do not hide a reference ("public . profiles", auth /* x */ . users).
//
// A section that must not run for Preview is framed like this in the migration:
//   -- preview:skip
//   ...
//   -- preview:end
//
// Differences to a plain schema rename: top level transaction control
// (begin/commit) is stripped, because the applier wraps every migration in its
// own transaction.

export const PREVIEW_SCHEMA = 'public_preview';
const SHARED_SCHEMAS = [
  'auth',
  'storage',
  'cron',
  'realtime',
  'vault',
  'net',
  'supabase_functions',
  'supabase_migrations',
  'graphql',
  'graphql_public',
  'pgsodium',
  'pgbouncer',
];
const SHARED = `(?:${SHARED_SCHEMAS.join('|')})`;
const NAME = String.raw`("(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
// Extensions that choose their own schema (cannot be moved)
const FIXED_EXTENSIONS = ['pg_cron', 'pg_net', 'pgsodium', 'supabase_vault'];

/** Splits SQL into sections: code, comment, string, identifier, dollar. */
export function sections(sql) {
  const parts = [];
  let i = 0;
  let code = 0;
  const n = sql.length;
  const push = (type, end) => {
    if (i > code) parts.push({ type: 'code', text: sql.slice(code, i) });
    parts.push({ type, text: sql.slice(i, end) });
    i = end;
    code = end;
  };
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') {
      const e = sql.indexOf('\n', i);
      push('comment', e < 0 ? n : e);
    } else if (c === '/' && d === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--;
          j += 2;
        } else j++;
      }
      push('comment', j);
    } else if (c === "'") {
      const escape =
        /[eE]/.test(sql[i - 1] ?? '') && !/[\w$]/.test(sql[i - 2] ?? '');
      let j = i + 1;
      while (j < n) {
        if (escape && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      push('string', Math.min(j, n));
    } else if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      push('identifier', Math.min(j, n));
    } else if (c === '$' && !/[\w$]/.test(sql[i - 1] ?? '')) {
      const m = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const e = sql.indexOf(m[0], i + m[0].length);
        push('dollar', e < 0 ? n : e + m[0].length);
      } else i++;
    } else i++;
  }
  if (code < n) parts.push({ type: 'code', text: sql.slice(code) });
  return parts;
}

/** Splits SQL into top level statements (semicolon outside comments, strings and $-bodies). */
export function statements(sql) {
  const list = [];
  let current = '';
  for (const t of sections(sql)) {
    if (t.type !== 'code') {
      current += t.text;
      continue;
    }
    const pieces = t.text.split(';');
    for (let k = 0; k < pieces.length; k++) {
      current += pieces[k];
      if (k < pieces.length - 1) {
        list.push(current + ';');
        current = '';
      }
    }
  }
  if (current.trim()) list.push(current);
  return list;
}

/** Text for detection: comments removed, strings and $-bodies optionally blanked. */
function detectionText(statement, { body }) {
  return sections(statement)
    .map(t => {
      if (t.type === 'comment') return ' ';
      if (t.type === 'string') return body ? t.text : "''";
      if (t.type === 'dollar') return body ? t.text : '$$ $$';
      return t.text;
    })
    .join('');
}

function stripComments(statement) {
  return sections(statement)
    .map(t => (t.type === 'comment' ? ' ' : t.text))
    .join('');
}

const QUALIFIED_SCHEMAS = [
  'public',
  'extensions',
  'pg_catalog',
  'information_schema',
  ...SHARED_SCHEMAS,
];

/**
 * Closes up schema qualifications so no rule can be bypassed by formatting:
 * comments become a space, "public . profiles" and public /* x *\/ . profiles
 * become public.profiles, "auth"."users" and auth."users" become auth.users
 * (shared schemas only, so the quoting of other names is kept).
 */
export function normalizeQualifiers(sql) {
  const list = QUALIFIED_SCHEMAS.join('|');
  const noComments = sections(sql)
    .map(t => (t.type === 'comment' ? ' ' : t.text))
    .join('');
  const shared = SHARED_SCHEMAS.join('|');
  return noComments
    .replace(
      new RegExp(`(?<![\\w$"])("?)(${list})\\1\\s*\\.\\s*(?=["A-Za-z_])`, 'g'),
      '$1$2$1.'
    )
    .replace(new RegExp(`"(${shared})"\\.`, 'g'), '$1.')
    .replace(
      new RegExp(`\\b(${shared})\\."([a-z_][a-z0-9_$]*)"`, 'g'),
      '$1.$2'
    );
}

const REFERENCE_TO_PUBLIC = /(?<![\w$"])public\./i;
const PLACEHOLDER = /'\u0000(\d+)\u0000'/g;

/**
 * Replaces the texts of "comment on ... is '...'" by placeholders so they keep
 * their public. (a comment is never executed). Every other string may be code
 * that runs in Preview (function body in '...', do '...', trigger argument,
 * stored SQL run later by execute); a public. left there would let Preview
 * write into Production, whereas an unnecessarily renamed data text only hits
 * Preview.
 */
function hideCommentTexts(sql) {
  const hidden = [];
  let head = '';
  const text = sections(sql)
    .map(t => {
      if (t.type === 'code') {
        const end = t.text.lastIndexOf(';');
        head = end < 0 ? head + t.text : t.text.slice(end + 1);
        return t.text;
      }
      head +=
        t.type === 'comment'
          ? ' '
          : t.type === 'string'
            ? "''"
            : t.type === 'dollar'
              ? '$$ $$'
              : t.text;
      if (
        t.type !== 'string' ||
        !/^\s*comment\s+on\b/i.test(head) ||
        !REFERENCE_TO_PUBLIC.test(t.text)
      ) {
        return t.text;
      }
      hidden.push(t.text);
      return `'\u0000${hidden.length - 1}\u0000'`;
    })
    .join('');
  return {
    text,
    restore: s => s.replace(PLACEHOLDER, (_, i) => hidden[Number(i)]),
  };
}

// One entry of a search_path list; the list ends at the first word without a comma before it
const PATH_ENTRY = String.raw`(?:"(?:[^"]|"")*"|'(?:[^']|'')*'|[\w$]+)`;
const SEARCH_PATH = new RegExp(
  String.raw`(\bsearch_path"?\s*(?:=|\bto\b)\s*)(${PATH_ENTRY}(?:\s*,\s*${PATH_ENTRY})*)`,
  'gi'
);

/** Replaces references to the schema public by public_preview. The role PUBLIC ("to public", "from public") stays. */
export function renameSchema(sql) {
  const s = PREVIEW_SCHEMA;
  const { text, restore } = hideCommentTexts(sql);
  return restore(
    text
      .replace(/"public"\./g, `"${s}".`)
      // also dynamically built names: format('public.%I', t) and 'public.' || t
      .replace(/(?<![\w$"])public\.(?=["A-Za-z_%'])/gi, `${s}.`)
      .replace(SEARCH_PATH, (_, head, list) => {
        return (
          head +
          list.replace(/(^|[\s,])(["']?)public\2(?=[\s,]|$)/gi, `$1$2${s}$2`)
        );
      })
      .replace(
        /('search_path'\s*,\s*')([^']*)'/gi,
        (_, head, list) =>
          `${head}${list.replace(/(^|[\s,])public(?=[\s,]|$)/gi, `$1${s}`)}'`
      )
      .replace(
        /\bschema\s+("?)public\1(?![\w.$])/gi,
        (_, q) => `schema ${q}${s}${q}`
      )
      .replace(
        /(\b(?:\w*schema\w*|nspname)\s*(?:=|<>|!=)\s*)'public'/gi,
        `$1'${s}'`
      )
      .replace(
        /(\b(?:\w*schema\w*|nspname)\s+(?:not\s+)?in\s*\()([^)]*)\)/gi,
        (_, head, list) => `${head}${list.replace(/'public'/g, `'${s}'`)})`
      )
      .replace(/'public'(\s*::\s*regnamespace)/gi, `'${s}'$1`)
      .replace(/(to_regnamespace\s*\(\s*)'public'/gi, `$1'${s}'`)
      // "if not exists (select 1 from pg_type where typname = 'x')" would find the object in public
      .replace(
        /(\b((?:\w+\.)?)(typ|rel|pro|con)name\s*=\s*'[^']*')(?!\s+and\s+(?:\w+\.)?\w+namespace\b)/gi,
        (_, comparison, alias, kind) =>
          `${comparison} and ${alias}${kind}namespace = '${s}'::regnamespace`
      )
  );
}

const R = (source, flags = 'i') => new RegExp(source, flags);

const TRIGGER_ON_SHARED_ANY = R(
  String.raw`\b(?:create|drop|alter|comment\s+on)\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\b[^;]*?\bon\s+(?:only\s+)?${SHARED}\.|\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${SHARED}\.\S+\s+(?:enable|disable)\s+(?:always\s+|replica\s+)?trigger\b`
);
const POLICY_ON_SHARED_ANY = R(
  String.raw`\b(?:create|alter|drop|comment\s+on)\s+policy\b[^;]*?\bon\s+(?:only\s+)?${SHARED}\.`
);
const FORBIDDEN = [
  [
    R(
      String.raw`\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:table|view|materialized\s+view|function|procedure|type|domain|sequence|aggregate|operator)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?${SHARED}\.`
    ),
    'creates or changes an object in a shared schema',
  ],
  [
    R(
      String.raw`\bcreate\s+(?:unique\s+)?index\b[^;]*?\bon\s+(?:only\s+)?${SHARED}\.`
    ),
    'creates an index in a shared schema',
  ],
  [
    R(
      String.raw`\b(?:create|alter|drop)\s+schema\s+(?:if\s+(?:not\s+)?exists\s+)?"?${SHARED}\b`
    ),
    'changes a shared schema',
  ],
  [
    R(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${SHARED}\.`),
    'changes a table in a shared schema',
  ],
  [
    R(
      String.raw`\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?|lock(?:\s+table)?|merge\s+into)\s+(?:only\s+)?(?:if\s+exists\s+)?${SHARED}\.`
    ),
    'changes data or locks a table in a shared schema',
  ],
  [
    // any other schema than public: writes only belong into public (public_preview)
    R(
      String.raw`\b(?:insert\s+into|delete\s+from|merge\s+into|truncate(?:\s+table)?|lock(?:\s+table)?)\s+(?:only\s+)?(?!public\.)"?[a-z_][\w$]*"?\s*\.\s*"?[a-z_]|\bupdate\s+(?:only\s+)?(?!public\.)(?!set\b)"?[a-z_][\w$]*"?\s*\.\s*"?[a-z_]`
    ),
    'writes to or locks a table of another schema than public',
  ],
  [
    R(
      String.raw`\b(?:truncate|lock)\b[^;]*,\s*(?!public\.)"?[a-z_][\w$]*"?\s*\.\s*"?[a-z_]`
    ),
    'truncates or locks a table of another schema than public',
  ],
  [
    R(String.raw`\bcopy\b[^;]*\b(?:from|to)\b`),
    'copy reads or writes files and tables outside of the schema',
  ],
  [
    R(String.raw`\b(?:drop|reassign)\s+owned\b`),
    'drop owned and reassign owned reach every schema of a role',
  ],
  [
    R(String.raw`\b(?:drop|alter|create)\s+schema\b`),
    'creates, alters or drops a schema',
  ],
  [
    R(String.raw`\balter\s+\w+(?:\s+\w+)?\s+[^;]*\bset\s+schema\b`),
    'moves an object into another schema',
  ],
  [
    R(String.raw`\b(?:set|reset)\s+(?:session\s+authorization|role)\b`),
    'switches the database role',
  ],
  [
    R(
      String.raw`\b(?:pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink\w*)\s*\(`
    ),
    'calls an administrative or file system function',
  ],
  [
    R(String.raw`\bcron\.`),
    'pg_cron lives in a shared schema, jobs of a branch must not be scheduled',
  ],
  [
    R(String.raw`\breferences\s+(?:only\s+)?(?!public\.)"?[a-z_][\w$]*"?\s*\.`),
    'foreign key to a table of another schema than public; the Preview role has no rights there. Frame it with "-- preview:skip" ... "-- preview:end" if it is needed in Production only',
  ],
  [
    R(
      String.raw`(?<!references\s)\bauth\.(?!(?:uid|jwt|role|email)\s*\()[a-z_][\w$]*\s*\(|(?<!references\s)\bstorage\.(?!(?:foldername|filename|extension)\s*\()[a-z_][\w$]*\s*\(`
    ),
    'calls a function of auth or storage that is not a read-only helper',
  ],
  [
    R(String.raw`\bcreate\s+extension\b[^;]*\bschema\s+"?public"?\b`),
    'create extension into schema public would put it into Production (use "with schema extensions")',
  ],
  [TRIGGER_ON_SHARED_ANY, 'trigger on auth or storage'],
  [POLICY_ON_SHARED_ANY, 'policy on auth or storage'],
  [
    R(
      String.raw`\b(?:grant|revoke)\b[^;]*?\bon\s+(?:table\s+|function\s+|sequence\s+|schema\s+|all\s+\w+\s+in\s+schema\s+)?"?${SHARED}\b`
    ),
    'grants rights in a shared schema',
  ],
  [
    R(
      String.raw`\bcomment\s+on\s+(?:table|column|function|view|type)\s+${SHARED}\.`
    ),
    'comments an object in a shared schema',
  ],
  [
    R(String.raw`\b(?:create|alter|drop)\s+event\s+trigger\b`),
    'event triggers apply to the whole database',
  ],
  [
    R(String.raw`\b(?:vault|net|supabase_functions|pgsodium)\.\w+\s*\(`),
    'calls a function with side effects in a shared schema',
  ],
  [
    R(String.raw`\balter\s+(?:role|user|database|system)\b`),
    'changes settings for the whole database or a role',
  ],
  [
    R(
      String.raw`\breset\s+(?:search_path|all)\b|\bset\s+(?:session\s+|local\s+)?search_path\s*(?:=|to)\s*default\b`
    ),
    'resets search_path, unqualified names would then hit public',
  ],
  [
    R(String.raw`\b(?:drop|alter)\s+extension\b`),
    'extensions apply to the whole database',
  ],
  // Cluster wide objects exist only once. Preview runs before public: it would
  // create them before the review and the later migration on public would
  // fail with "role already exists".
  [
    R(String.raw`\b(?:create|drop)\s+(?:role|user|group)\b`),
    'roles apply to the whole database',
  ],
  [
    R(
      String.raw`\bgrant\s+(?:(?!\bon\b)[^;])*?\bto\b|\brevoke\s+(?:(?!\bon\b)[^;])*?\bfrom\b`
    ),
    'changes role memberships, which apply to the whole database',
  ],
  [
    R(String.raw`\b(?:create|alter|drop)\s+publication\b`),
    'publications (realtime) apply to the whole database',
  ],
  [
    R(String.raw`\balter\s+default\s+privileges\b(?![^;]*\bin\s+schema\b)`),
    'default privileges without "in schema" apply to all schemas, also public',
  ],
  [
    R(
      String.raw`\balter\s+default\s+privileges\b[^;]*\bin\s+schema\s+"?${SHARED}\b`
    ),
    'grants default privileges in a shared schema',
  ],
  [
    R(
      String.raw`\b(?:create|drop)\s+cast\b|\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:trusted\s+)?(?:procedural\s+)?language\b`
    ),
    'casts and languages apply to the whole database',
  ],
  [
    R(
      String.raw`\b(?:create|alter|drop)\s+(?:database|tablespace|subscription|server|foreign\s+data\s+wrapper)\b`
    ),
    'creates or changes an object for the whole database',
  ],
];

function removeMarkedSections(sql) {
  const out = [];
  let open = false;
  for (const line of sql.split('\n')) {
    if (/^\s*--\s*preview:skip\b/i.test(line)) {
      if (open)
        throw new Error("'-- preview:skip' twice without '-- preview:end'");
      open = true;
      continue;
    }
    if (/^\s*--\s*preview:end\b/i.test(line)) {
      if (!open)
        throw new Error("'-- preview:end' without preceding '-- preview:skip'");
      open = false;
      continue;
    }
    if (!open) out.push(line);
  }
  if (open)
    throw new Error("'-- preview:skip' without closing '-- preview:end'");
  return out.join('\n');
}

const TRANSACTION_CONTROL =
  /^\s*(?:begin|start\s+transaction|commit|end)(?:\s+(?:work|transaction))?\s*;?\s*$/i;

/** Statements whose strings are plain text, never executed. */
const TEXT_ONLY = /^\s*comment\s+on\b/i;

/**
 * @param {string} sql content of a migration file
 * @returns {{ sql: string, errors: string[] }}
 *   sql: migration rewritten for public_preview
 *   errors: statements that are rejected or cannot be rewritten safely
 */
export function rewrite(sql) {
  const errors = [];
  let source;
  try {
    source = removeMarkedSections(sql);
  } catch (e) {
    return { sql: '', errors: [e.message] };
  }
  const out = [];

  for (const original of statements(source)) {
    const statement = normalizeQualifiers(original);
    const short = statement.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!short || short === ';') {
      out.push(original);
      continue;
    }
    // The applier wraps every migration in its own transaction.
    if (TRANSACTION_CONTROL.test(statement)) continue;
    if (/^\s*(?:rollback|abort)\b/i.test(statement)) {
      errors.push(`rollback inside a migration: ${short}`);
      continue;
    }

    // Everything is checked, also function bodies, DO blocks, strings (dynamic
    // SQL) and CTEs. Only the text of "comment on" is skipped.
    const detection = detectionText(statement, {
      body: !TEXT_ONLY.test(statement),
    });
    const forbidden = FORBIDDEN.find(([r]) => r.test(detection));
    if (forbidden) {
      errors.push(`${forbidden[1]}: ${short}`);
      continue;
    }

    const next = renameSchema(statement);
    if (/'public'/.test(stripComments(next))) {
      errors.push(
        `'public' as a value, e.g. as schema in format() or quote_ident(); this cannot be rewritten safely. Write public.name directly: ${short}`
      );
      continue;
    }
    out.push(next);
  }
  return { sql: out.join(''), errors };
}

/**
 * Additional rules for NEW migrations. Preview runs before public; a check that
 * leaves the schema open would later find the Preview object in public and skip itself.
 * @returns {string[]} errors
 */
export function newMigrationChecks(sql) {
  const errors = [];
  let source;
  try {
    source = removeMarkedSections(sql);
  } catch (e) {
    return [e.message];
  }
  for (const a of statements(source)) {
    const t = stripComments(a);
    const short = t.replace(/\s+/g, ' ').trim().slice(0, 120);
    const withoutSchema = (column, schemaColumn) =>
      R(String.raw`\b${column}\s*(?:=|in\b)`).test(t) &&
      !R(String.raw`\b${schemaColumn}\b`).test(t);
    const findings = [
      ['typname', 'typnamespace'],
      ['relname', 'relnamespace'],
      ['proname', 'pronamespace'],
      ['conname', 'connamespace'],
      ['tgname', 'tgrelid'],
      ['policyname', 'schemaname'],
      ['indexname', 'schemaname'],
      ['tablename', 'schemaname'],
      ['viewname', 'schemaname'],
      ['table_name', 'table_schema'],
      ['routine_name', 'routine_schema'],
      ['constraint_name', 'constraint_schema'],
    ].filter(([s, n]) => withoutSchema(s, n));
    if (findings.length > 0) {
      errors.push(
        `Catalog query on ${findings.map(([s]) => s).join(', ')} without schema (e.g. "and ${findings[0][1]} = 'public'::regnamespace" or "= 'public'"); otherwise public finds the object from public_preview: ${short}`
      );
    }
    if (/\bto_reg(?:class|type|proc|procedure)\s*\(\s*'[^'.]+'\s*\)/i.test(t)) {
      errors.push(
        `to_regclass/to_regtype without schema, write 'public.name': ${short}`
      );
    }
    for (const m of t.matchAll(
      /\bcreate\s+extension\s+(if\s+not\s+exists\s+)?"?([\w-]+)"?([^;']*)/gi
    )) {
      if (!m[1])
        errors.push(`create extension without "if not exists": ${short}`);
      if (
        !/\bwith\s+schema\b|\bschema\s+\w/i.test(m[3]) &&
        !FIXED_EXTENSIONS.includes(m[2].toLowerCase())
      ) {
        errors.push(
          `create extension ${m[2]} without "with schema extensions"; otherwise it lands in the search path of public_preview: ${short}`
        );
      }
    }
    if (new RegExp(PREVIEW_SCHEMA, 'i').test(t)) {
      errors.push(
        `Migrations must not mention ${PREVIEW_SCHEMA}, the Preview copy is generated: ${short}`
      );
    }
  }
  return errors;
}

/**
 * Statements of a structure-only dump of public (supabase db dump) that must
 * not be replayed: schema level statements (the schema is created by the setup
 * script), session settings, extensions and publication membership.
 */
const DUMP_SKIP = [
  /^\s*set\s/i,
  /^\s*reset\s/i,
  /^\s*select\s+pg_catalog\.set_config\b/i,
  /^\s*create\s+schema\b/i,
  /^\s*alter\s+schema\b/i,
  /^\s*comment\s+on\s+schema\b/i,
  /^\s*(?:grant|revoke)\b[^;]*\bon\s+schema\b/i,
  /^\s*create\s+extension\b/i,
  /^\s*comment\s+on\s+extension\b/i,
  /^\s*alter\s+publication\b/i,
  // ownership and default privileges belong to the postgres role, the Preview
  // role owns everything it creates
  /^\s*alter\s+[^;]*\bowner\s+to\b/i,
  /^\s*alter\s+default\s+privileges\b/i,
  // foreign keys to auth.* and other schemas: the Preview role has no REFERENCES there
  /^\s*alter\s+table\b[^;]*\bforeign\s+key\b[^;]*\breferences\s+"?(?!public"?\.)[a-z_][\w$]*"?\s*\./i,
];

/**
 * Rewrites a structure-only dump of public for public_preview. Only the
 * structure is copied, never rows. Returns the same shape as rewrite().
 */
export function rewriteDump(dump) {
  const kept = statements(dump).filter(
    s => !DUMP_SKIP.some(r => r.test(normalizeQualifiers(s)))
  );
  return rewrite(kept.join(''));
}
