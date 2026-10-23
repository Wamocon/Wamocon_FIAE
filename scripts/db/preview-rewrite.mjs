// Rewrites a migration for the schema public_preview (pure logic, no database).
//
// Why: Production and Preview share one Supabase database. Preview works in the
// schema public_preview, a structural copy of public. Every migration therefore
// runs a second time, rewritten, on public_preview, and it does so BEFORE the
// review and before public. Migrations refer to public explicitly
// (public.table, set search_path = public); without rewriting, Preview
// functions would write into Production.
//
// Objects outside of public (same auth, same storage, same pg_cron) get Preview
// twins:
//   - triggers on auth.* and storage.*  -> name with suffix _preview; the called
//     function swallows errors in Preview (exception when others) so a bug in
//     unreviewed PR code cannot break a Production sign-in. Cancellations
//     (statement_timeout, cancel) and ASSERT are not caught by OTHERS.
//   - policies on auth.* and storage.*  -> name with suffix _preview
//   - storage buckets                   -> id with suffix -preview (except
//     SHARED_BUCKETS, which Preview shares and separates by a path prefix)
//   - pg_cron jobs                      -> name with suffix -preview, command
//     with search_path public_preview
// Anything the check cannot rewrite safely (FORBIDDEN, including cluster wide
// objects such as roles or publications) is rejected. A section that must not
// run for Preview is framed like this in the migration:
//   -- preview:skip
//   ...
//   -- preview:end
//
// Differences to a plain schema rename: top level transaction control
// (begin/commit) is stripped, because the applier wraps every migration in its
// own transaction.

export const PREVIEW_SCHEMA = 'public_preview';
// Suffix of the Preview twins of buckets and cron jobs.
export const PREVIEW_SUFFIX = '-preview';
// Buckets that Preview shares with Production. The app separates them by the
// object path prefix preview/ (see src/lib/db-schema.ts), so no twin is made.
export const SHARED_BUCKETS = ['content', 'avatar'];
// Marks lines of the error shell that is added to Preview trigger functions;
// the structure comparison ignores them.
export const SHELL_MARKER = '-- preview:shell';

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
const MAX_NAME = 63;
const CRON_PATH = `set search_path = ${PREVIEW_SCHEMA}, extensions; `;
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

function withSuffix(name, suffix) {
  const raw = name.startsWith('"') ? name.slice(1, -1) : name;
  if (raw.length + suffix.length > MAX_NAME) {
    throw new Error(
      `Name "${raw}${suffix}" is longer than ${MAX_NAME} characters`
    );
  }
  return name.startsWith('"') ? `"${raw}${suffix}"` : `${name}${suffix}`;
}

/** "auth"."users" and auth."users" become auth.users so the detection finds them. */
function unquoteSharedSchemas(sql) {
  const list = SHARED_SCHEMAS.join('|');
  return sql
    .replace(new RegExp(`"(${list})"\\.`, 'g'), '$1.')
    .replace(new RegExp(`\\b(${list})\\."([a-z_][a-z0-9_$]*)"`, 'g'), '$1.$2');
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

const TRIGGER_CREATE = R(
  String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+${NAME}\s+(?:before|after|instead\s+of)\b[\s\S]*?\bon\s+(?:only\s+)?(?:auth|storage)\.`
);
const TRIGGER_ON_SHARED = [
  TRIGGER_CREATE,
  R(
    String.raw`\bdrop\s+trigger\s+(?:if\s+exists\s+)?${NAME}\s+on\s+(?:only\s+)?(?:auth|storage)\.`
  ),
  R(String.raw`\bcomment\s+on\s+trigger\s+${NAME}\s+on\s+(?:auth|storage)\.`),
  R(String.raw`\balter\s+trigger\s+${NAME}\s+on\s+(?:auth|storage)\.`),
  R(
    String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:auth|storage)\.\S+\s+(?:enable|disable)\s+(?:always\s+|replica\s+)?trigger\s+`
  ),
];
const POLICY_ON_SHARED = [
  R(
    String.raw`\b(?:create|alter)\s+policy\s+${NAME}\s+on\s+(?:auth|storage)\.`
  ),
  R(
    String.raw`\bdrop\s+policy\s+(?:if\s+exists\s+)?${NAME}\s+on\s+(?:auth|storage)\.`
  ),
  R(String.raw`\bcomment\s+on\s+policy\s+${NAME}\s+on\s+(?:auth|storage)\.`),
];
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
      String.raw`\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:only\s+)?${SHARED}\.(?!buckets\b)`
    ),
    'changes data in a shared schema',
  ],
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

function renameTrigger(a) {
  const rename = (m, head, name) => head + withSuffix(name, '_preview');
  return a
    .replace(
      R(
        String.raw`(\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+)${NAME}`,
        'gi'
      ),
      rename
    )
    .replace(
      R(String.raw`(\bdrop\s+trigger\s+(?:if\s+exists\s+)?)${NAME}`, 'gi'),
      rename
    )
    .replace(R(String.raw`(\bcomment\s+on\s+trigger\s+)${NAME}`, 'gi'), rename)
    .replace(R(String.raw`(\balter\s+trigger\s+)${NAME}`, 'gi'), rename)
    .replace(
      R(
        String.raw`(\balter\s+trigger\s+\S+\s+on\s+\S+\s+rename\s+to\s+)${NAME}`,
        'gi'
      ),
      rename
    )
    .replace(
      R(
        String.raw`(\b(?:enable|disable)\s+(?:always\s+|replica\s+)?trigger\s+)${NAME}`,
        'gi'
      ),
      (m, head, name) =>
        /^(all|user)$/i.test(name) ? m : head + withSuffix(name, '_preview')
    );
}

function renamePolicy(a) {
  const rename = (m, head, name) => head + withSuffix(name, '_preview');
  return a
    .replace(
      R(String.raw`(\b(?:create|alter)\s+policy\s+)${NAME}`, 'gi'),
      rename
    )
    .replace(
      R(String.raw`(\bdrop\s+policy\s+(?:if\s+exists\s+)?)${NAME}`, 'gi'),
      rename
    )
    .replace(R(String.raw`(\bcomment\s+on\s+policy\s+)${NAME}`, 'gi'), rename)
    .replace(
      R(
        String.raw`(\balter\s+policy\s+\S+\s+on\s+\S+\s+rename\s+to\s+)${NAME}`,
        'gi'
      ),
      rename
    );
}

/** Arguments of a call from `start` (right behind the opening parenthesis): [{ from, to }], null without closing parenthesis. */
function callArguments(text, start) {
  const list = [];
  let depth = 0;
  let from = start;
  let pos = start;
  for (const t of sections(text.slice(start))) {
    if (t.type !== 'code') {
      pos += t.text.length;
      continue;
    }
    for (let k = 0; k < t.text.length; k++, pos++) {
      const c = t.text[k];
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) {
          list.push({ from, to: pos });
          return list;
        }
        depth--;
      } else if (c === ',' && depth === 0) {
        list.push({ from, to: pos });
        from = pos + 1;
      }
    }
  }
  return null;
}

/** Value of an argument without "name =>": { from, to, kind } with kind "text", "dollar" or "other". */
function argumentValue(text, arg) {
  const raw = text.slice(arg.from, arg.to);
  const prefix = /^\s*(?:[a-z_]+\s*(?:=>|:=)\s*)?/i.exec(raw)[0];
  const from = arg.from + prefix.length;
  const value = text.slice(from, arg.to).trimEnd();
  const kind = /^'(?:[^']|'')*'$/.test(value)
    ? 'text'
    : /^(\$[A-Za-z_]*\$)[\s\S]*\1$/.test(value)
      ? 'dollar'
      : 'other';
  return {
    from,
    to: from + value.length,
    kind,
    value,
    name: /^\s*([a-z_]+)\s*(?:=>|:=)/i.exec(raw)?.[1]?.toLowerCase(),
  };
}

/** Cron jobs get the suffix -preview, their command runs with search_path public_preview. */
function rewriteCron(text) {
  const calls = [
    ...text.matchAll(
      /\bcron\.(schedule_in_database|schedule|unschedule|alter_job)\s*\(/gi
    ),
  ];
  const changes = [];
  for (const m of calls) {
    const fn = m[1].toLowerCase();
    if (fn === 'alter_job') {
      throw new Error(
        'cron.alter_job works with job ids and cannot be rewritten for Preview'
      );
    }
    const args = callArguments(text, m.index + m[0].length);
    if (!args) throw new Error(`cron.${fn}( without closing parenthesis`);
    const values = args.map(a => argumentValue(text, a));
    const named = n => values.find(w => w.name === n);
    const positional = values.filter(w => !w.name);
    let name;
    let command;
    if (fn === 'unschedule') name = named('job_name') ?? positional[0];
    else if (fn === 'schedule_in_database') {
      name = named('job_name') ?? positional[0];
      command = named('command') ?? positional[2];
    } else {
      name =
        named('job_name') ??
        (positional.length >= 3 ? positional[0] : undefined);
      command =
        named('command') ??
        (positional.length >= 3 ? positional[2] : positional[1]);
    }
    if (fn === 'unschedule' && name?.kind !== 'text') {
      throw new Error(
        'cron.unschedule only with the job name as a literal, not with an id or variable'
      );
    }
    if (name && name.kind !== 'text') {
      throw new Error('Cron job name must be a literal');
    }
    if (name) {
      const raw = name.value.slice(1, -1);
      // only the name argument itself; the same text as data inside the command stays
      if (!raw.endsWith(PREVIEW_SUFFIX)) {
        changes.push({
          pos: name.from,
          length: name.to - name.from,
          insert: `'${raw}${PREVIEW_SUFFIX}'`,
        });
      }
    }
    if (command) {
      if (command.kind === 'other') {
        throw new Error('Cron command must be a literal');
      }
      const head =
        command.kind === 'text'
          ? 1
          : /^\$[A-Za-z_]*\$/.exec(command.value)[0].length;
      changes.push({
        pos: command.from + head,
        length: 0,
        insert:
          command.kind === 'text' ? CRON_PATH.replace(/'/g, "''") : CRON_PATH,
      });
    }
  }
  let out = text;
  for (const c of changes.sort((x, y) => y.pos - x.pos)) {
    out = out.slice(0, c.pos) + c.insert + out.slice(c.pos + c.length);
  }
  // queries on cron.job: jobname = 'x' and jobname in ('x', 'y')
  const rename = literal =>
    literal.replace(/'((?:[^']|'')*)'/g, (m, n) =>
      n.endsWith(PREVIEW_SUFFIX) ? m : `'${n}${PREVIEW_SUFFIX}'`
    );
  return out
    .replace(
      /(\bjobname"?\s*(?:=|<>|!=)\s*)('(?:[^']|'')*')/gi,
      (_, head, literal) => head + rename(literal)
    )
    .replace(
      /(\bjobname"?\s+(?:not\s+)?in\s*\()([^)]*)\)/gi,
      (_, head, list) => `${head}${rename(list)})`
    );
}

/**
 * Renames bucket ids only where they are meant as buckets: bucket_id = 'x',
 * bucket_id in (...), statements on storage.buckets.
 * @returns {{ text: string, named: string[] }} named: all known buckets that occur as a bucket
 */
function renameBuckets(text, buckets, toRename) {
  const named = new Set();
  const replaceIn = piece =>
    piece.replace(/'((?:[^']|'')*)'/g, (m, value) => {
      if (!buckets.includes(value)) return m;
      named.add(value);
      return toRename.includes(value) ? `'${value}${PREVIEW_SUFFIX}'` : m;
    });
  const comparisons = (column, piece) =>
    piece
      .replace(
        R(String.raw`(\b${column}"?\s*(?:=|<>|!=)\s*)('(?:[^']|'')*')`, 'gi'),
        (_, head, literal) => head + replaceIn(literal)
      )
      .replace(
        R(String.raw`(\b${column}"?\s+(?:not\s+)?in\s*\()([^)]*)\)`, 'gi'),
        (_, head, list) => `${head}${replaceIn(list)})`
      );
  const out = comparisons('bucket_id', text)
    // insert/update/delete on storage.buckets: every known name is a bucket there
    .replace(
      /\b(?:insert\s+into|update|delete\s+from)\s+storage\.buckets\b[^;]*/gi,
      m => replaceIn(m)
    )
    // queries on storage.buckets: only the columns id and name
    .replace(/\bfrom\s+storage\.buckets\b[^;]*/gi, m =>
      comparisons('(?:id|name)', m)
    );
  return { text: out, named: [...named] };
}

/** Own buckets that still stand as a literal after renameBuckets. */
export function unrecognizedBuckets(text, ownBuckets) {
  const rest = new Set();
  for (const m of stripComments(text).matchAll(/'((?:[^']|'')*)'/g)) {
    if (ownBuckets.includes(m[1])) rest.add(m[1]);
  }
  return [...rest];
}

/** All bucket ids that any migration creates in storage.buckets. */
export function bucketsFrom(contents) {
  const ids = new Set();
  for (const sql of contents) {
    for (const a of statements(unquoteSharedSchemas(sql))) {
      const t = stripComments(a);
      if (!/\binsert\s+into\s+storage\.buckets\b/i.test(t)) continue;
      const values = t.slice(t.search(/\bvalues\b/i));
      for (const m of values.matchAll(/\(\s*'([^']+)'/g)) ids.add(m[1]);
    }
  }
  return [...ids];
}

/** Functions that triggers on auth.* or storage.* call (they get an error shell in Preview). */
export function triggerFunctionsFrom(contents) {
  const names = new Set();
  for (const sql of contents) {
    for (const a of statements(unquoteSharedSchemas(sql))) {
      const t = detectionText(a, { body: false });
      if (!TRIGGER_CREATE.test(t)) continue;
      const m =
        /\bexecute\s+(?:function|procedure)\s+(?:"?public"?\.)?"?([A-Za-z_][\w$]*)"?\s*\(/i.exec(
          t
        );
      if (m) names.add(m[1].toLowerCase());
    }
  }
  return [...names];
}

/**
 * Wraps the plpgsql body in a shell that catches errors and lets the record
 * pass. "when others" does not catch QUERY_CANCELED or ASSERT_FAILURE; such an
 * abort in the Preview body still aborts the Production sign-in. The shell
 * therefore only promises: errors in Preview code are caught.
 */
function withErrorShell(statement, fn) {
  const parts = sections(statement);
  const i = parts.findIndex(t => t.type === 'dollar');
  if (i < 0) throw new Error(`Body of ${fn} not found`);
  const mark = /^\$[A-Za-z_]*\$/.exec(parts[i].text)[0];
  let body = parts[i].text.slice(mark.length, -mark.length).replace(/\s+$/, '');
  if (!body.endsWith(';')) body += ';';
  const shell = [
    `begin ${SHELL_MARKER}`,
    body,
    `exception when others then ${SHELL_MARKER}`,
    `  raise warning 'Preview trigger % failed, error caught: %', '${fn}', sqlerrm; ${SHELL_MARKER}`,
    `  return case when tg_op = 'DELETE' then old else new end; ${SHELL_MARKER}`,
    `end; ${SHELL_MARKER}`,
    '',
  ].join('\n');
  parts[i] = { type: 'dollar', text: `${mark}\n${shell}${mark}` };
  return parts.map(t => t.text).join('');
}

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

/**
 * @param {string} sql content of a migration file
 * @param {{ buckets?: string[], triggerFunctions?: string[] }} [options]
 *   buckets: all known bucket ids (bucketsFrom), triggerFunctions: see triggerFunctionsFrom
 * @returns {{ sql: string, shared: string[], errors: string[] }}
 *   sql: migration rewritten for public_preview
 *   shared: rewritten statements that create shared objects (auth, storage, cron)
 *   errors: statements that cannot be rewritten safely
 */
export function rewrite(sql, { buckets = [], triggerFunctions = [] } = {}) {
  const errors = [];
  const shared = [];
  let source;
  try {
    source = removeMarkedSections(sql);
  } catch (e) {
    return { sql: '', shared, errors: [e.message] };
  }
  const ownBuckets = buckets.filter(b => !SHARED_BUCKETS.includes(b));
  const out = [];

  for (const original of statements(source)) {
    const statement = unquoteSharedSchemas(original);
    const short = stripComments(statement)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    if (!short || short === ';') {
      out.push(statement);
      continue;
    }
    // The applier wraps every migration in its own transaction.
    if (TRANSACTION_CONTROL.test(stripComments(statement))) continue;
    if (/^\s*(?:rollback|abort)\b/i.test(stripComments(statement))) {
      errors.push(`rollback inside a migration: ${short}`);
      continue;
    }

    const full = stripComments(statement);
    const isDo = /^\s*do\b/i.test(detectionText(statement, { body: false }));
    const isCron = /\bcron\.\w+\s*\(/i.test(full);
    const isFunction =
      /^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(full);
    // DO blocks and cron commands run during the migration: check body and strings too
    const detection = detectionText(statement, {
      body: isDo || (isCron && !isFunction),
    });

    if (/^\s*create\s+extension\b/i.test(detection)) {
      out.push(statement);
      continue;
    }

    const isTrigger = TRIGGER_ON_SHARED.some(r => r.test(detection));
    const isPolicy = POLICY_ON_SHARED.some(r => r.test(detection));
    const isBucket = /\b(?:insert\s+into|update)\s+storage\.buckets\b/i.test(
      detection
    );
    const fn =
      /^\s*create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)"?([A-Za-z_][\w$]*)"?\s*\(/i
        .exec(detection)?.[1]
        ?.toLowerCase();
    const needsShell = fn && triggerFunctions.includes(fn);

    if ((isTrigger || isPolicy) && isDo) {
      errors.push(
        `Trigger or policy on auth/storage inside a DO block, write it as a separate statement: ${short}`
      );
      continue;
    }
    if (
      isTrigger &&
      /\b(?:enable|disable)\s+(?:always\s+|replica\s+)?trigger\s+(?:all|user)\b/i.test(
        detection
      )
    ) {
      errors.push(
        `Switches all triggers of a shared table, this would hit Production too: ${short}`
      );
      continue;
    }
    const forbidden = FORBIDDEN.find(
      ([r]) =>
        r.test(detection) &&
        !(isTrigger && /\balter\s+table\b/i.test(detection))
    );
    if (forbidden) {
      errors.push(`${forbidden[1]}: ${short}`);
      continue;
    }
    if (needsShell && !/\blanguage\s+'?plpgsql'?/i.test(detection)) {
      errors.push(
        `${fn} is called by a trigger on auth/storage and must be plpgsql: ${short}`
      );
      continue;
    }

    let next;
    try {
      next = renameSchema(statement);
      if (isTrigger) next = renameTrigger(next);
      if (isPolicy) next = renamePolicy(next);
      if (isCron) next = rewriteCron(next);
      if (needsShell) next = withErrorShell(next, fn);
    } catch (e) {
      errors.push(`${e.message}: ${short}`);
      continue;
    }

    if (/\bstorage\./i.test(full)) {
      const { named } = renameBuckets(full, buckets, []);
      const sharedNamed = named.filter(b => SHARED_BUCKETS.includes(b));
      if (
        (isBucket || isPolicy) &&
        named.length > 0 &&
        sharedNamed.length === named.length
      ) {
        continue; // concerns only shared buckets: nothing to create for Preview
      }
      if (sharedNamed.length > 0) {
        errors.push(
          `Statement mixes own and shared buckets (${sharedNamed.join(', ')}): ${short}`
        );
        continue;
      }
      if (
        isPolicy &&
        named.length === 0 &&
        /\b(?:create|alter)\s+policy\b/i.test(detection)
      ) {
        errors.push(
          `Storage policy without bucket reference, its Preview twin would apply to the Production buckets too: ${short}`
        );
        continue;
      }
      next = renameBuckets(next, buckets, ownBuckets).text;
      // If an own bucket still stands there as a literal, it was at a place the
      // rules do not know; Preview code would run against the Production bucket.
      const rest = unrecognizedBuckets(next, ownBuckets);
      if (rest.length > 0) {
        errors.push(
          `Bucket name at a place that cannot be rewritten safely (${rest.join(', ')}); write it as bucket_id = '...' or bucket_id in (...): ${short}`
        );
        continue;
      }
    }

    if (/'public'/.test(stripComments(next))) {
      errors.push(
        `'public' as a value, e.g. as schema in format() or quote_ident(); this cannot be rewritten safely. Write public.name directly: ${short}`
      );
      continue;
    }

    if (
      isTrigger ||
      isPolicy ||
      isBucket ||
      (isCron && !isFunction) ||
      needsShell
    ) {
      shared.push(next);
    }
    out.push(next);
  }
  return { sql: out.join(''), shared, errors };
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
];

/**
 * Rewrites a structure-only dump of public for public_preview. Only the
 * structure is copied, never rows. Returns the same shape as rewrite().
 */
export function rewriteDump(dump, options = {}) {
  const kept = statements(dump).filter(
    s => !DUMP_SKIP.some(r => r.test(stripComments(s)))
  );
  return rewrite(kept.join(''), options);
}
