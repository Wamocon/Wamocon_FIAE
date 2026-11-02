// Renames the component folders of the FIAE delivery (06-01-26 LFA\FIAE\Komponenten) from the old
// numbering (02_, 13_) to the labels of the platform (2.1_ for the base component, 2.2_ for its
// Vertiefung). Single components (1, 7, 12, 19, 23 to 26) keep their name, a folder that already has
// the new name is left as it is. Only the names of the component folders directly under the given
// folder are changed. No file inside a folder is read, written or moved, nothing is deleted.
//
// Commands:
//   plan     <folder>                    (default, read only) lists old and new name of every folder
//   apply    <folder> --log <file.json>  renames the folders and writes the log for the way back
//   rollback <file.json>                 renames the folders back with the log
//
// Safety: apply stops before the first rename when a number is unclear (2.3_, 13.1_, 27_), when two
// folders belong to one component, when a target name already exists (also in another spelling of
// upper and lower case) or when the log file already exists. The log is written after every single
// rename, so a run that stops in the middle can still be turned back with rollback. Rollback checks
// first that every folder to rename back is there and that its old name is free.
//
// No network, no database.

import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  describeComponent,
  listComponentFolders,
  newFolderPrefix,
} from './fiae-component-folder.mjs';

/**
 * What would happen to every component folder under `root`:
 * { items: [{ from, to, action, nr, name }], problems }. action is 'rename' (a pair in the old
 * spelling), 'keep' (single component) or 'new' (already named 2.1_ or 2.2_). `to` equals `from`
 * unless the action is 'rename'.
 */
export function planRenames(root) {
  const { folders, problems } = listComponentFolders(root);
  const items = [];
  for (const f of folders) {
    const name = describeComponent(f.nr);
    const prefix = newFolderPrefix(f.nr);
    if (f.spelling === 'new') {
      items.push({
        from: f.dirName,
        to: f.dirName,
        action: 'new',
        nr: f.nr,
        name,
      });
      continue;
    }
    // a single component has no dot in its label: nothing to rename
    if (!prefix.includes('.')) {
      items.push({
        from: f.dirName,
        to: f.dirName,
        action: 'keep',
        nr: f.nr,
        name,
      });
      continue;
    }
    const rest = /^\s*\d+([_ ].*)$/.exec(f.dirName);
    const separator = rest[1].charAt(0);
    const title = rest[1].slice(1);
    items.push({
      from: f.dirName,
      to: `${prefix.slice(0, -1)}${separator}${title}`,
      action: 'rename',
      nr: f.nr,
      name,
    });
  }
  // a target name that is taken (by another folder or file, in any case) or built twice stops apply
  const present = new Set(readdirSyncSafe(root).map(n => n.toLowerCase()));
  const targets = new Set();
  for (const item of items.filter(i => i.action === 'rename')) {
    const key = item.to.toLowerCase();
    if (present.has(key))
      problems.push(
        `The target name already exists: ${item.to} (for ${item.from}).`
      );
    if (targets.has(key))
      problems.push(`Two folders get the same name: ${item.to}.`);
    targets.add(key);
  }
  return { items, problems };
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Renames the folders of the plan and writes the log after every rename. Returns { renamed }. */
export function applyRenames(root, logFile) {
  const { items, problems } = planRenames(root);
  if (problems.length)
    throw new Error(`Nothing renamed: ${problems.join(' ')}`);
  if (existsSync(logFile))
    throw new Error(`Nothing renamed: the log file ${logFile} already exists.`);
  const log = {
    version: 1,
    createdAt: new Date().toISOString(),
    root: path.resolve(root),
    renamed: [],
  };
  writeFileSync(logFile, JSON.stringify(log, null, 1));
  for (const item of items.filter(i => i.action === 'rename')) {
    try {
      renameSync(path.join(root, item.from), path.join(root, item.to));
    } catch (error) {
      throw new Error(
        `Stopped at ${item.from}: ${error?.message ?? error}. ${log.renamed.length} folders are renamed, turn them back with: rollback ${logFile}`
      );
    }
    log.renamed.push({ from: item.from, to: item.to });
    writeFileSync(logFile, JSON.stringify(log, null, 1));
  }
  return { renamed: log.renamed };
}

/** Renames the folders of a log back (in the reverse order). Returns { restored }. */
export function rollbackRenames(logFile) {
  const log = JSON.parse(readFileSync(logFile, 'utf8'));
  if (
    log?.version !== 1 ||
    typeof log.root !== 'string' ||
    !Array.isArray(log.renamed)
  )
    throw new Error(`${logFile} is no log of this tool.`);
  const problems = [];
  for (const { from, to } of log.renamed) {
    if (!existsSync(path.join(log.root, to)))
      problems.push(`The folder ${to} is not there.`);
    if (existsSync(path.join(log.root, from)))
      problems.push(`The old name ${from} is already taken.`);
  }
  if (problems.length)
    throw new Error(`Nothing renamed back: ${problems.join(' ')}`);
  const restored = [];
  for (const { from, to } of [...log.renamed].reverse()) {
    renameSync(path.join(log.root, to), path.join(log.root, from));
    restored.push({ from: to, to: from });
  }
  return { restored };
}

export function parseArgs(argv) {
  const out = { command: null, target: null, log: null, errors: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--log') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--'))
        out.errors.push('--log needs a value.');
      else out.log = v;
      i++;
    } else if (a.startsWith('--')) out.errors.push(`Unknown option ${a}.`);
    else rest.push(a);
  }
  [out.command, out.target] = rest;
  if (rest.length > 2) out.errors.push('Too many arguments.');
  if (!['plan', 'apply', 'rollback'].includes(out.command))
    out.errors.push('The command is plan, apply or rollback.');
  else if (!out.target)
    out.errors.push(
      out.command === 'rollback'
        ? 'The log file is missing.'
        : 'The folder of the components is missing.'
    );
  if (out.command === 'apply' && !out.log)
    out.errors.push('apply needs --log <file.json> for the way back.');
  if (out.command !== 'apply' && out.log)
    out.errors.push('--log belongs to apply.');
  return out;
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.errors.length) {
    args.errors.forEach(e => console.error(`Error: ${e}`));
    return 2;
  }
  try {
    if (args.command === 'rollback') {
      const { restored } = rollbackRenames(args.target);
      restored.forEach(r => console.log(`  ${r.from}  ->  ${r.to}`));
      console.log(
        `Rolled back: ${restored.length} folders have their old name again.`
      );
      return 0;
    }
    if (!existsSync(args.target)) {
      console.error(`Refused: ${args.target} does not exist.`);
      return 1;
    }
    const { items, problems } = planRenames(args.target);
    for (const item of items) {
      const mark = { rename: 'rename', keep: 'keep  ', new: 'as is ' }[
        item.action
      ];
      console.log(
        item.action === 'rename'
          ? `  ${mark}  ${item.from}  ->  ${item.to}   [${item.name}]`
          : `  ${mark}  ${item.from}   [${item.name}]`
      );
    }
    const count = a => items.filter(i => i.action === a).length;
    console.log(
      `${items.length} component folders: ${count('rename')} to rename, ${count('keep')} single components stay, ${count('new')} already new.`
    );
    problems.forEach(p => console.error(`Problem: ${p}`));
    if (args.command === 'plan') {
      console.log('Plan only: nothing was renamed.');
      return problems.length ? 1 : 0;
    }
    const { renamed } = applyRenames(args.target, args.log);
    console.log(
      `Done: ${renamed.length} folders renamed. Log for the way back: ${args.log} (rollback ${args.log}).`
    );
    return 0;
  } catch (error) {
    console.error(`Failed: ${error?.message ?? error}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === 'fiae-folder-renumber.mjs'
) {
  process.exit(main(process.argv.slice(2)));
}
