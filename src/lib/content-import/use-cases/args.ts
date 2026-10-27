// Arguments of scripts/import/kfbm-use-cases.mjs. Pure functions: no process
// access, no database, so the tests can run them.
//
// The arguments are those of the apply script (apply/target.ts): plan, check
// and run, the source folder or --plan, --target local|preview, --created-by,
// the dry run as default, --apply, --update-existing, --confirm-host for a real
// run against the Preview, production refused in every case. The one
// difference is the switch for the solutions: --use-case-solutions (instead of
// --scenario-solutions) writes the model solutions and the criteria. It is only
// for check and run and not allowed for the Preview, because the policy
// cd_select of content_documents lets the public key read rows without an
// organization.

import { parseApplyArgs } from '../apply/target';
import type { ApplyArgs } from '../apply/target';

export type UseCaseArgs = ApplyArgs & { useCaseSolutions: boolean };

export type ParsedUseCaseArgs =
  | { ok: true; args: UseCaseArgs }
  | { ok: false; errors: string[] };

const SOLUTIONS_FLAG = '--use-case-solutions';
const SCENARIO_FLAG = /^--scenario-solutions(?:=|$)/;
const TARGET_FLAG = /^--target(?:=|$)/;
const PREVIEW_MESSAGE = `${SOLUTIONS_FLAG} is not allowed for the Preview: the policy cd_select of content_documents lets the public key read rows without an organization, so the solution text must not be written there until that policy is restricted.`;

/** The value given to --target, as written (not checked). */
function targetValue(tokens: string[]): string | undefined {
  const at = tokens.findIndex(token => TARGET_FLAG.test(token));
  if (at < 0) return undefined;
  const token = tokens[at];
  return token.includes('=')
    ? token.slice(token.indexOf('=') + 1)
    : tokens[at + 1];
}

export function parseUseCaseArgs(argv: string[]): ParsedUseCaseArgs {
  const useCaseSolutions = argv.includes(SOLUTIONS_FLAG);
  const rest = argv.filter(token => token !== SOLUTIONS_FLAG);
  const extra: string[] = [];
  // The switch of the scenarios belongs to the content import, not here.
  if (rest.some(token => SCENARIO_FLAG.test(token))) {
    extra.push('Unknown argument: --scenario-solutions');
  }
  if (useCaseSolutions) {
    if (rest[0] === 'plan') {
      extra.push(`${SOLUTIONS_FLAG} belongs to check and run`);
    }
    if (targetValue(rest) === 'preview') extra.push(PREVIEW_MESSAGE);
  }
  const parsed = parseApplyArgs(
    rest.filter(token => !SCENARIO_FLAG.test(token))
  );
  if (parsed.ok) {
    // The files that are written get fixed endings, so a source document or a
    // plan can not be named as output.
    const { out, reportOut, command, target } = parsed.args;
    if (command === 'plan' && out && !/\.json$/i.test(out)) {
      extra.push(
        '--out must be a .json file (the summary is written next to it)'
      );
    }
    if (reportOut && !/\.md$/i.test(reportOut)) {
      extra.push('--report-out must be a .md file');
    }
    // Decided on the parsed target as well, not only on the raw tokens.
    if (
      useCaseSolutions &&
      target === 'preview' &&
      !extra.includes(PREVIEW_MESSAGE)
    ) {
      extra.push(PREVIEW_MESSAGE);
    }
  }
  if (!parsed.ok) {
    return { ok: false, errors: [...new Set([...parsed.errors, ...extra])] };
  }
  if (extra.length > 0) return { ok: false, errors: extra };
  return { ok: true, args: { ...parsed.args, useCaseSolutions } };
}
