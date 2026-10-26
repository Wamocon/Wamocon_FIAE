// Arguments of scripts/import/kfbm-learning-fields.mjs. Pure functions: no
// process access, no database, so the tests can run them.
//
// Same rules as the apply script of the content import (apply/target.ts):
//  - the default of `run` is a dry run (everything is executed, then rolled
//    back), a real run needs --apply
//  - --target local|preview is always required for `check` and `run`, and it is
//    compared with the facts of the connection before anything is read
//  - production is refused in every case, there is no switch for it
//  - a real run against the Preview also needs --confirm-host <host>

import type { ApplyTarget } from '../apply/target';

export type LearningFieldCommand = 'plan' | 'check' | 'run';

export interface LearningFieldArgs {
  command: LearningFieldCommand;
  /** plan: the mapping table (.xlsx). */
  excel: string | null;
  /** plan: apply plan of the content import (kfbm-apply.mjs plan --out). */
  importPlan: string | null;
  /** plan: source folder of the content import (names only are read). */
  importSource: string | null;
  /** plan: titles, a .json file of the owner or the source list (.csv). */
  titles: string | null;
  decisions: string | null;
  /** plan: file for the plan JSON. */
  out: string | null;
  /** check and run: the plan file written by `plan`. */
  plan: string | null;
  /** check and run: file for the report. */
  reportOut: string | null;
  target: ApplyTarget | null;
  /** Real run. false = dry run (the default). */
  apply: boolean;
  updateExisting: boolean;
  confirmHost: string | null;
}

export type ParsedLearningFieldArgs =
  | { ok: true; args: LearningFieldArgs }
  | { ok: false; errors: string[] };

const COMMANDS: LearningFieldCommand[] = ['plan', 'check', 'run'];
const TARGETS: ApplyTarget[] = ['local', 'preview'];
const FLAGS = new Set(['--apply', '--update-existing']);
const VALUE_OPTIONS = new Set([
  '--import-plan',
  '--import-source',
  '--titles',
  '--decisions',
  '--out',
  '--plan',
  '--report-out',
  '--target',
  '--confirm-host',
  '--created-by',
]);
const PRODUCTION_MESSAGE =
  'Production is not supported by this script (no target, no switch). An apply to production needs the Go of the owner and the rollout (KFBM_ROLLOUT_APPROVED) and is not planned.';

function splitToken(token: string): [string, string | undefined] {
  const eq = token.indexOf('=');
  return token.startsWith('--') && eq > 0
    ? [token.slice(0, eq), token.slice(eq + 1)]
    : [token, undefined];
}

export function parseLearningFieldArgs(
  argv: string[]
): ParsedLearningFieldArgs {
  const [first, ...rest] = argv;
  if (!first || !COMMANDS.includes(first as LearningFieldCommand)) {
    return {
      ok: false,
      errors: ['The first argument must be plan, check or run'],
    };
  }
  const command = first as LearningFieldCommand;

  const errors: string[] = [];
  let production = false;
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const [name, inline] = splitToken(rest[i]);
    if (/production/i.test(name)) {
      production = true;
    } else if (FLAGS.has(name) && inline === undefined) {
      flags.add(name);
    } else if (VALUE_OPTIONS.has(name)) {
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

  const database = command !== 'plan';
  const writes = command === 'run';
  const rawTarget = values.get('--target');
  if (rawTarget !== undefined && /production/i.test(rawTarget)) {
    production = true;
  }
  if (production) return { ok: false, errors: [PRODUCTION_MESSAGE] };

  if (values.has('--created-by')) {
    errors.push(
      '--created-by is not used here (learning fields have no author column)'
    );
  }
  if (positional.length > 1 && command === 'plan') {
    errors.push('Only one mapping table may be given');
  }

  if (
    command === 'plan' &&
    values.has('--out') &&
    !/\.json$/i.test(values.get('--out') as string)
  ) {
    errors.push(
      '--out must be a .json file (the summary is written next to it)'
    );
  }

  const excel = positional[0] ?? null;
  const importPlan = values.get('--import-plan') ?? null;
  const importSource = values.get('--import-source') ?? null;
  const plan = values.get('--plan') ?? null;

  if (command === 'plan') {
    if (!excel) errors.push('plan needs the mapping table (an .xlsx file)');
    if (!importPlan && !importSource) {
      errors.push(
        'plan needs --import-plan <apply plan> or --import-source <source folder>'
      );
    }
    if (importPlan && importSource) {
      errors.push('Give either --import-plan or --import-source, not both');
    }
    for (const name of [
      '--plan',
      '--target',
      '--confirm-host',
      '--report-out',
    ]) {
      if (values.has(name)) errors.push(`${name} belongs to check and run`);
    }
    for (const name of ['--apply', '--update-existing']) {
      if (flags.has(name)) errors.push(`${name} belongs to run`);
    }
  } else {
    if (positional.length > 0) {
      errors.push(
        'check and run take the plan file, not the table (run plan first)'
      );
    }
    if (!plan) errors.push('check and run need --plan <learning field plan>');
    for (const name of [
      '--out',
      '--import-plan',
      '--import-source',
      '--titles',
      '--decisions',
    ]) {
      if (values.has(name)) errors.push(`${name} belongs to plan`);
    }
    if (!writes) {
      for (const name of ['--apply', '--update-existing']) {
        if (flags.has(name)) errors.push(`${name} belongs to run`);
      }
    }
  }

  let target: ApplyTarget | null = null;
  if (database) {
    if (rawTarget === undefined) {
      if (!errors.some(e => e.startsWith('--target'))) {
        errors.push('--target local|preview is required');
      }
    } else if (!TARGETS.includes(rawTarget as ApplyTarget)) {
      errors.push('--target must be local or preview');
    } else {
      target = rawTarget as ApplyTarget;
    }
  }

  const confirmHost = values.get('--confirm-host')?.toLowerCase() ?? null;
  const apply = flags.has('--apply');
  if (database) {
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
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };

  return {
    ok: true,
    args: {
      command,
      excel: command === 'plan' ? excel : null,
      importPlan,
      importSource,
      titles: values.get('--titles') ?? null,
      decisions: values.get('--decisions') ?? null,
      out: values.get('--out') ?? null,
      plan,
      reportOut: values.get('--report-out') ?? null,
      target,
      apply,
      updateExisting: flags.has('--update-existing'),
      confirmHost,
    },
  };
}
