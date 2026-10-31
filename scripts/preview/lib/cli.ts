/**
 * The run of the two Preview test progress scripts (seed and reset).
 *
 * The default is a DRY RUN: everything happens in one transaction that is rolled back, the
 * counts are printed, the storage is only read. A real run needs --apply and
 * --confirm-host <host of the database connection>. Every run needs --target preview and
 * the database role app_preview_migrator, so a connection to Production is refused. The log
 * names no e-mail address, no key and no connection string.
 */
import dotenv from 'dotenv';
import postgres from 'postgres';
import {
  checkTarget,
  clearProgress,
  findTrainer,
  hostOf,
  loadTrainees,
  missingTables,
  parseArgs,
  seedTrainee,
  type Options,
} from './test-progress';
import {
  listTraineeFiles,
  removeTraineeFiles,
  type StorageAccess,
} from './submission-files';

class DryRun extends Error {}

const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};

function storageAccess(): StorageAccess | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export async function main(command: Options['command'], argv: string[]) {
  const parsed = parseArgs(argv, command);
  if (!parsed.ok) return fail(parsed.error);
  const options = parsed.options;

  dotenv.config({ path: '.env.local' });
  const url = process.env[options.dbUrlEnv];
  if (!url) return fail(`The variable ${options.dbUrlEnv} is not set.`);
  const dbHost = hostOf(url);

  const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
  const files: { org: string; trainee: string; paths: string[] }[] = [];
  const access = storageAccess();

  try {
    const [{ role }] = await sql`select current_user as role`;
    const problem = checkTarget({ role, dbHost, options });
    if (problem) return fail(problem);
    console.log(
      `Role ${role.split('.')[0]}, host ${dbHost}, mode ${options.apply ? 'APPLY' : 'DRY RUN'}`
    );

    try {
      await sql.begin(async tx => {
        await tx.unsafe(`set local search_path = public_preview`);
        const missing = await missingTables(tx);
        if (missing.length) {
          throw new Error(
            `Tables missing in public_preview: ${missing.join(', ')}`
          );
        }
        const trainees = await loadTrainees(tx, options.emails);
        if (trainees.length === 0) throw new Error('No trainee found.');
        const trainer = await findTrainer(tx);

        if (command === 'reset') {
          const counts = await clearProgress(
            tx,
            trainees.map(t => t.id)
          );
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          console.log(`Removed ${total} rows:`);
          for (const [table, n] of Object.entries(counts)) {
            if (n) console.log(`  ${table.padEnd(30)} ${n}`);
          }
          if (!options.keepFiles) {
            if (!access) {
              console.log(
                'Files: no storage key in the environment, uploaded files were not touched.'
              );
            } else {
              for (const t of trainees) {
                files.push({
                  org: t.organization_id,
                  trainee: t.id,
                  paths: await listTraineeFiles(
                    access,
                    t.organization_id,
                    t.id
                  ),
                });
              }
            }
          }
        }

        if (!(command === 'reset' && options.clearOnly)) {
          for (const t of trainees) {
            const s = await seedTrainee(tx, t, trainer);
            console.log(
              `Seeded ${t.id.slice(0, 8)} (${s.level}): quiz ${s.quiz}, use case ${s.useCase}, enabler ${s.enabler}, reports ${s.reports}`
            );
          }
        }
        if (!options.apply) throw new DryRun();
      });
    } catch (error) {
      if (!(error instanceof DryRun)) throw error;
      console.log('Dry run, rolled back. Nothing was written.');
    }

    // files go after the commit: a failed transaction must not leave a trainee without them
    const total = files.reduce((n, f) => n + f.paths.length, 0);
    if (command === 'reset' && access && !options.keepFiles) {
      if (options.apply) {
        for (const f of files) {
          await removeTraineeFiles(access, f.org, f.trainee, f.paths);
        }
        console.log(`Removed ${total} uploaded files.`);
      } else {
        console.log(`Would remove ${total} uploaded files.`);
      }
    }
  } finally {
    await sql.end();
  }
}
