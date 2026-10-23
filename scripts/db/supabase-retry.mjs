// Calls the Supabase CLI exactly as the workflows did ("supabase db push
// --linked") and repeats the call when the login at the database is rejected.
// Usage: node scripts/db/supabase-retry.mjs <CLI arguments>
//
// Why: the CLI creates the login role cli_login_postgres with a new password
// for every call. If two workflows start at the same moment (a push to master
// starts the Preview migration and, later, other jobs), one resets the
// password of the other and fails with "password authentication failed for
// user cli_login_postgres".
//
// Only this error is repeated (LOGIN_REJECTED): it occurs before the CLI runs
// a statement, so a second attempt cannot apply anything twice. Every other
// error counts immediately, with the exit code of the CLI. Attempts and pause
// are set by SUPABASE_CLI_RETRIES (default 4) and SUPABASE_CLI_PAUSE (seconds,
// default 20, grows per attempt). Standard output and error output of the CLI
// stay separate, so the call can still end in "| tee file.txt" and "grep".

import { spawnSync } from 'node:child_process';
import { LOGIN_REJECTED, cliProgram, sleep } from './preview-cli.mjs';

const parameters = process.argv.slice(2);
if (parameters.length === 0) {
  console.error(
    'Usage: node scripts/db/supabase-retry.mjs <arguments of the Supabase CLI>'
  );
  process.exit(2);
}

const attempts = Number(process.env.SUPABASE_CLI_RETRIES ?? 4);
const pause = Number(process.env.SUPABASE_CLI_PAUSE ?? 20);
const [program, lead] = cliProgram();

for (let attempt = 1; ; attempt++) {
  const r = spawnSync(program, [...lead, ...parameters], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
  const out = r.stdout ?? '';
  const err = r.stderr ?? '';
  const rejected = r.status !== 0 && LOGIN_REJECTED.test(`${out}${err}`);
  if (rejected && attempt < attempts) {
    process.stderr.write(err);
    console.error(
      `Database login rejected (attempt ${attempt} of ${attempts}), probably a concurrent run. Retrying in ${pause * attempt} seconds.`
    );
    sleep(pause * attempt);
    continue;
  }
  process.stdout.write(out);
  process.stderr.write(err);
  if (r.error) {
    console.error(`The Supabase CLI could not be started: ${r.error.message}`);
  }
  process.exitCode = r.status ?? 1;
  break;
}
