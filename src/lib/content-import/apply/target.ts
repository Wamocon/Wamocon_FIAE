// Arguments and target protection of scripts/import/kfbm-apply.mjs. Pure
// functions: no process access, no database, so the tests can run them.
//
// Rules:
//  - the default of `run` is a dry run (everything is executed, then rolled
//    back), a real run needs --apply
//  - --target local|preview is always required for `check` and `run`, and it
//    is compared with the facts of the connection (host, current_schema, the
//    schema that the table names resolve to, role) before anything is read
//  - production is refused in every case. There is no --target production, no
//    switch and no confirmation that allows it. Apply to production needs the
//    Go of the owner and the rollout (KFBM_ROLLOUT_APPROVED), which does not
//    exist yet, and then a change of this file.
//  - a real run against the Preview also needs --confirm-host <host of the
//    connection>
//
// Modelled on src/lib/hai/reindexArgs.ts.

export type ApplyTarget = 'local' | 'preview';
export type ApplyCommand = 'plan' | 'check' | 'run' | 'check-quizzes';

export interface ApplyArgs {
  command: ApplyCommand;
  /**
   * Folder of the source documents (plan, or check and run without --plan).
   * Optional when a quiz JSON file is given.
   */
  source: string | null;
  /** Quiz JSON with the enabler quizzes (schema 1.0), see quiz-json/. */
  quizzesJson: string | null;
  /** Quiz JSON with the global quizzes. */
  globalQuizzesJson: string | null;
  /** A quiz of the JSON replaces the Word quiz of the same content key. */
  preferJsonQuizzes: boolean;
  /** Plan file written by `plan`. */
  plan: string | null;
  /** plan: file for the plan JSON. */
  out: string | null;
  /** check and run: file for the report. */
  reportOut: string | null;
  decisions: string | null;
  /** Component codes the plan is limited to, upper case. */
  components: string[];
  hydrate: boolean;
  timeoutSeconds: number | null;
  noAttributes: boolean;
  target: ApplyTarget | null;
  /** Profile (uuid) that is entered as author of courses and quizzes. */
  createdBy: string | null;
  /** Real run. false = dry run (the default). */
  apply: boolean;
  updateExisting: boolean;
  /**
   * Also write the trainer-only parts of the scenarios (solution and
   * knowledge text) into content_documents. Off by default, not allowed for
   * the Preview (see PRODUCTION_MESSAGE neighbours below).
   */
  scenarioSolutions: boolean;
  confirmHost: string | null;
}

export type ParsedApplyArgs =
  | { ok: true; args: ApplyArgs }
  | { ok: false; errors: string[] };

export interface ConnectionFacts {
  host: string | null;
  currentSchema: string | null;
  /** Schema that the unqualified name training_catalogs resolves to. */
  resolvedSchema: string | null;
  currentUser: string | null;
  /** The login role. It differs from currentUser if the role was switched. */
  sessionUser?: string | null;
  /** The database has the Preview schemas or roles (it is the hosted database). */
  hasPreviewMarkers?: boolean | null;
}

/** Roles of the Preview database (supabase/preview-setup/01-preview-role.sql). */
export const PREVIEW_ROLES = ['app_preview', 'app_preview_migrator'];
export const PREVIEW_SCHEMA = 'public_preview';
export const PRODUCTION_SCHEMA = 'public';

const COMMANDS: ApplyCommand[] = ['plan', 'check', 'run'];
const QUIZ_JSON_COMMANDS: ApplyCommand[] = [...COMMANDS, 'check-quizzes'];
const TARGETS: ApplyTarget[] = ['local', 'preview'];
const FLAGS = new Set([
  '--apply',
  '--update-existing',
  '--scenario-solutions',
  '--hydrate',
  '--no-attributes',
]);
const QUIZ_JSON_FLAGS = new Set(['--prefer-json-quizzes']);
const QUIZ_JSON_VALUES = new Set(['--quizzes-json', '--global-quizzes-json']);
const VALUE_OPTIONS = new Set([
  '--out',
  '--report-out',
  '--plan',
  '--decisions',
  '--components',
  '--timeout',
  '--target',
  '--created-by',
  '--confirm-host',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPONENT_CODE = /^K\d{1,2}(?:\.\d)?$/i;
const PRODUCTION_MESSAGE =
  'Production is not supported by this script (no target, no switch). An apply to production needs the Go of the owner and the rollout (KFBM_ROLLOUT_APPROVED) and is not planned.';

function splitToken(token: string): [string, string | undefined] {
  const eq = token.indexOf('=');
  return token.startsWith('--') && eq > 0
    ? [token.slice(0, eq), token.slice(eq + 1)]
    : [token, undefined];
}

export interface ParseApplyOptions {
  /**
   * Accept the quiz JSON sources (--quizzes-json, --global-quizzes-json,
   * --prefer-json-quizzes) and the command check-quizzes. Only the content
   * import script has them.
   */
  quizJson?: boolean;
}

export function parseApplyArgs(
  argv: string[],
  parseOptions: ParseApplyOptions = {}
): ParsedApplyArgs {
  const errors: string[] = [];
  const quizJson = parseOptions.quizJson === true;
  const [first, ...rest] = argv;
  if (
    !first ||
    !(quizJson ? QUIZ_JSON_COMMANDS : COMMANDS).includes(first as ApplyCommand)
  ) {
    return {
      ok: false,
      errors: [
        quizJson
          ? 'The first argument must be plan, check, run or check-quizzes'
          : 'The first argument must be plan, check or run',
      ],
    };
  }
  const command = first as ApplyCommand;

  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const [name, inline] = splitToken(rest[i]);
    if (/production/i.test(name)) {
      errors.push(PRODUCTION_MESSAGE);
    } else if (
      (FLAGS.has(name) || (quizJson && QUIZ_JSON_FLAGS.has(name))) &&
      inline === undefined
    ) {
      flags.add(name);
    } else if (
      VALUE_OPTIONS.has(name) ||
      (quizJson && QUIZ_JSON_VALUES.has(name))
    ) {
      const value = inline ?? rest[++i];
      if (value === undefined || value === '' || value.startsWith('--')) {
        errors.push(`${name} needs a value`);
      } else if (values.has(name)) {
        errors.push(`${name} is given twice`);
      } else {
        values.set(name, value);
      }
    } else if (name.startsWith('--')) {
      errors.push(`Unknown argument: ${rest[i]}`);
    } else {
      positional.push(rest[i]);
    }
  }
  if (positional.length > 1) {
    errors.push('Only one source folder may be given');
  }

  const source = positional[0] ?? null;
  const plan = values.get('--plan') ?? null;
  const writes = command === 'run';
  const database = command === 'check' || command === 'run';
  const quizzesJson = values.get('--quizzes-json') ?? null;
  const globalQuizzesJson = values.get('--global-quizzes-json') ?? null;
  const hasJson = quizzesJson !== null || globalQuizzesJson !== null;
  const preferJsonQuizzes = flags.has('--prefer-json-quizzes');
  for (const [name, value] of [
    ['--quizzes-json', quizzesJson],
    ['--global-quizzes-json', globalQuizzesJson],
  ]) {
    if (value !== null && !/\.json$/i.test(value)) {
      errors.push(`${name} must name a .json file`);
    }
  }
  if (preferJsonQuizzes && !(source && hasJson)) {
    errors.push(
      '--prefer-json-quizzes needs the source folder and a quiz JSON file'
    );
  }
  if (plan && hasJson) {
    errors.push('Give either --plan or the quiz JSON files, not both');
  }

  if (command === 'check-quizzes') {
    if (!hasJson) {
      errors.push(
        'check-quizzes needs --quizzes-json and/or --global-quizzes-json'
      );
    }
    if (source) errors.push('check-quizzes takes no source folder');
    for (const name of [
      '--plan',
      '--out',
      '--target',
      '--created-by',
      '--confirm-host',
      '--decisions',
      '--components',
      '--timeout',
    ]) {
      if (values.has(name)) {
        errors.push(`${name} does not belong to check-quizzes`);
      }
    }
    for (const name of [
      '--apply',
      '--update-existing',
      '--scenario-solutions',
      '--hydrate',
      '--no-attributes',
    ]) {
      if (flags.has(name)) {
        errors.push(`${name} does not belong to check-quizzes`);
      }
    }
  } else if (command === 'plan') {
    if (!source && !hasJson) {
      errors.push(
        quizJson
          ? 'plan needs the source folder or a quiz JSON file'
          : 'plan needs the source folder'
      );
    }
    if (plan) errors.push('--plan belongs to check and run');
    for (const name of [
      '--target',
      '--created-by',
      '--confirm-host',
      '--report-out',
    ]) {
      if (values.has(name)) errors.push(`${name} belongs to check and run`);
    }
  } else {
    if (source && plan) {
      errors.push('Give either the source folder or --plan, not both');
    }
    if (!source && !plan && !hasJson) {
      errors.push(
        quizJson
          ? 'check and run need the source folder, a quiz JSON file or --plan <file>'
          : 'check and run need the source folder or --plan <file>'
      );
    }
    if (values.has('--out')) errors.push('--out belongs to plan');
    if (plan && values.has('--components')) {
      errors.push('--components only works together with the source folder');
    }
  }
  if (command !== 'check-quizzes') {
    for (const name of ['--hydrate', '--no-attributes']) {
      if (flags.has(name) && !source) {
        errors.push(`${name} only works together with the source folder`);
      }
    }
  }
  if (!writes && command !== 'check-quizzes') {
    if (flags.has('--apply')) errors.push('--apply belongs to run');
    if (flags.has('--update-existing')) {
      errors.push('--update-existing belongs to run');
    }
  }

  let target: ApplyTarget | null = null;
  const rawTarget = values.get('--target');
  if (database) {
    if (rawTarget === undefined) {
      if (!errors.some(e => e.startsWith('--target'))) {
        errors.push('--target local|preview is required');
      }
    } else if (/production/i.test(rawTarget)) {
      errors.push(PRODUCTION_MESSAGE);
    } else if (!TARGETS.includes(rawTarget as ApplyTarget)) {
      errors.push('--target must be local or preview');
    } else {
      target = rawTarget as ApplyTarget;
    }
  }

  if (
    flags.has('--scenario-solutions') &&
    !database &&
    command !== 'check-quizzes'
  ) {
    errors.push('--scenario-solutions belongs to check and run');
  }
  if (flags.has('--scenario-solutions') && target === 'preview') {
    errors.push(
      '--scenario-solutions is not allowed for the Preview: the policy cd_select of content_documents lets the public key read rows without an organization, so the solution text must not be written there until that policy is restricted.'
    );
  }

  const createdBy = values.get('--created-by') ?? null;
  if (database) {
    if (!createdBy) {
      errors.push('--created-by <profile uuid> is required');
    } else if (!UUID.test(createdBy)) {
      errors.push('--created-by must be the uuid of a profile');
    }
  }

  const confirmHost = values.get('--confirm-host')?.toLowerCase() ?? null;
  const apply = flags.has('--apply');
  if (confirmHost !== null && !(writes && apply && target === 'preview')) {
    errors.push(
      '--confirm-host only belongs to run --apply with --target preview'
    );
  }
  if (writes && apply && target === 'preview' && confirmHost === null) {
    errors.push(
      'A real run against the Preview needs --confirm-host <host of the connection>'
    );
  }

  const components: string[] = [];
  const rawComponents = values.get('--components');
  if (rawComponents !== undefined) {
    for (const part of rawComponents.split(',')) {
      const code = part.trim();
      if (!COMPONENT_CODE.test(code)) {
        errors.push(`--components names an invalid component: ${code}`);
      } else if (!components.includes(code.toUpperCase())) {
        components.push(code.toUpperCase());
      }
    }
  }

  const rawTimeout = values.get('--timeout');
  let timeoutSeconds: number | null = null;
  if (rawTimeout !== undefined) {
    timeoutSeconds = Number(rawTimeout);
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) {
      errors.push('--timeout needs a whole number of seconds');
    }
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };

  return {
    ok: true,
    args: {
      command,
      source,
      quizzesJson,
      globalQuizzesJson,
      preferJsonQuizzes,
      plan,
      out: values.get('--out') ?? null,
      reportOut: values.get('--report-out') ?? null,
      decisions: values.get('--decisions') ?? null,
      components,
      hydrate: flags.has('--hydrate'),
      timeoutSeconds,
      noAttributes: flags.has('--no-attributes'),
      target,
      createdBy: createdBy ? createdBy.toLowerCase() : null,
      apply,
      updateExisting: flags.has('--update-existing'),
      scenarioSolutions: flags.has('--scenario-solutions'),
      confirmHost,
    },
  };
}

export interface ParsedConnection {
  host: string;
  port: number | null;
  user: string;
  password: string;
  database: string;
  sslmode: string | null;
}

const SSL_MODES = [
  'disable',
  'prefer',
  'require',
  'no-verify',
  'verify-ca',
  'verify-full',
];

/**
 * Reads the connection string into explicit fields. The script builds the
 * client from these fields and never hands the string to the driver, because
 * the driver lets a query parameter (?host=, ?options=, ?user=) override the
 * host of the URL, which would defeat the host check. Only ?sslmode= is
 * accepted, any other parameter is refused.
 */
export function parseConnectionString(
  connectionString: string
):
  | { ok: true; connection: ParsedConnection }
  | { ok: false; errors: string[] } {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { ok: false, errors: ['The connection string cannot be read.'] };
  }
  const errors: string[] = [];
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    errors.push('The connection string must start with postgresql://.');
  }
  const host = url.hostname.toLowerCase();
  if (!host || host.includes(',') || host.startsWith('/')) {
    errors.push('The connection string needs exactly one host name.');
  }
  let sslmode: string | null = null;
  for (const [key, value] of url.searchParams) {
    if (key !== 'sslmode') {
      errors.push(
        `The connection string parameter ${key} is not accepted (only sslmode).`
      );
    } else if (!SSL_MODES.includes(value)) {
      errors.push('The sslmode of the connection string is not known.');
    } else {
      sslmode = value;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  try {
    return {
      ok: true,
      connection: {
        host,
        port: url.port ? Number(url.port) : null,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.replace(/^\//, '')),
        sslmode,
      },
    };
  } catch {
    return {
      ok: false,
      errors: ['The connection string cannot be read.'],
    };
  }
}

/** Host of a connection string, or null if it cannot be read. */
export function connectionHost(connectionString: string): string | null {
  try {
    return new URL(connectionString).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function isLoopbackHost(host: string | null): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]'
  );
}

/**
 * Check of the target against the host of the connection string alone, before
 * the first connection is opened.
 */
export function checkTargetHost(
  target: ApplyTarget | null,
  host: string | null
): string[] {
  if (!host) return ['The host of the connection cannot be read.'];
  const loopback = isLoopbackHost(host);
  if (target === 'local' && !loopback) {
    return [
      `--target local needs a loopback host, the connection goes to ${host}.`,
    ];
  }
  if (target === 'preview' && loopback) {
    return [
      'The connection goes to a loopback host, that is not the Preview. Use --target local.',
    ];
  }
  if (target !== 'local' && target !== 'preview') {
    return ['--target local|preview is required.'];
  }
  return [];
}

/**
 * Check of the target against the facts of the open connection. Returns the
 * reasons to stop, an empty list means the connection fits the target.
 *
 *  - local: loopback host, schema public
 *  - preview: non-loopback host, schema public_preview (also the schema that
 *    the table names resolve to) and a Preview role. A connection to the
 *    schema public on a hosted database looks like production and is refused.
 */
export function checkTargetFacts(
  target: ApplyTarget | null,
  facts: ConnectionFacts
): string[] {
  const errors = checkTargetHost(target, facts.host);
  if (errors.length > 0) return errors;
  if (!facts.currentSchema || !facts.currentUser || !facts.resolvedSchema) {
    return [
      'current_schema, the role or the schema of the table names is unknown.',
    ];
  }
  if (facts.sessionUser && facts.sessionUser !== facts.currentUser) {
    errors.push(
      `The role was switched (login ${facts.sessionUser}, current role ${facts.currentUser}).`
    );
  }
  if (target === 'local') {
    if (facts.hasPreviewMarkers) {
      errors.push(
        'The database has the Preview schemas or roles. A local database has none, this looks like the hosted database (reached over a tunnel?) and is refused.'
      );
    }
    if (facts.currentSchema !== PRODUCTION_SCHEMA) {
      errors.push(
        `--target local expects the schema public, current_schema is ${facts.currentSchema}.`
      );
    }
    if (facts.resolvedSchema !== PRODUCTION_SCHEMA) {
      errors.push(
        `The table names resolve to the schema ${facts.resolvedSchema}, --target local expects public.`
      );
    }
  } else {
    if (facts.currentSchema === PRODUCTION_SCHEMA) {
      errors.push(
        'The connection uses the schema public on a hosted database. That looks like production and is refused.'
      );
    } else if (facts.currentSchema !== PREVIEW_SCHEMA) {
      errors.push(
        `--target preview expects the schema ${PREVIEW_SCHEMA}, current_schema is ${facts.currentSchema}.`
      );
    }
    if (facts.resolvedSchema !== PREVIEW_SCHEMA) {
      errors.push(
        `The table names resolve to the schema ${facts.resolvedSchema}, --target preview expects ${PREVIEW_SCHEMA}.`
      );
    }
    if (!PREVIEW_ROLES.includes(facts.currentUser)) {
      errors.push(
        `--target preview expects a Preview role (${PREVIEW_ROLES.join(', ')}), the role is ${facts.currentUser}.`
      );
    }
  }
  return errors;
}

/** A real run in the Preview names the host of the connection. */
export function checkConfirmHost(
  args: Pick<ApplyArgs, 'apply' | 'target' | 'confirmHost'>,
  host: string | null
): string[] {
  if (args.apply && args.target === 'preview' && args.confirmHost !== host) {
    return [
      `--confirm-host must name the host of the connection (${host ?? 'unknown'}).`,
    ];
  }
  return [];
}
