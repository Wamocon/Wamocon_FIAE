// Planned hours of the KfBM use cases (the categories of the activity report) from the total hours of
// their training component. The source of the use cases has no hours of its own, so every component
// shares its total hours between its use cases: whole hours, the remainder one hour each to the first
// use cases in order. A use case that already has hours is never changed, a component without total
// hours (the integrative ones) is left out and reported. There is no difficulty of a use case in the
// data, so the share is the same for all use cases of a component.
// Only the Preview exists as a target. The report holds the old values for the rollback.
//
// Commands:
//   plan     --target preview                                   read only
//   run      --target preview [--apply --confirm-host <db host>] [--out report.json]
//   rollback <report.json> --target preview [--apply --confirm-host <db host>]
//
// Connection: DB_CONNECTION_STRING (role app_preview_migrator) from the environment.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  openVerifiedClient,
  prepareConnection,
  redact,
} from './kfbm-session.mjs';

const S = 'public_preview';

/** Shares total whole hours between count use cases: the sum is the total, the first ones get one more. */
export function distributeHours(total, count) {
  if (
    !Number.isFinite(total) ||
    total <= 0 ||
    !Number.isInteger(count) ||
    count < 1
  )
    return [];
  const whole = Math.round(total);
  const base = Math.floor(whole / count);
  const rest = whole - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

export function parseArgs(argv) {
  const out = {
    command: null,
    source: null,
    target: null,
    apply: false,
    confirmHost: null,
    out: null,
    errors: [],
  };
  const rest = [];
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      out.errors.push(`${name} needs a value.`);
      return null;
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--target') out.target = value(i++, a);
    else if (a === '--confirm-host') out.confirmHost = value(i++, a);
    else if (a === '--out') out.out = value(i++, a);
    else if (a.startsWith('--')) out.errors.push(`Unknown option ${a}.`);
    else rest.push(a);
  }
  [out.command, out.source] = rest;
  if (!['plan', 'run', 'rollback'].includes(out.command))
    out.errors.push('The command is plan, run or rollback.');
  if (out.command === 'rollback' && !out.source)
    out.errors.push('The report file is missing.');
  if (out.target !== 'preview')
    out.errors.push(
      'Every run needs --target preview. Production is not possible.'
    );
  if (out.apply && out.command === 'plan')
    out.errors.push('--apply belongs to run and rollback.');
  return out;
}

export async function main(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.errors.length) {
    args.errors.forEach(e => console.error(`Error: ${e}`));
    return 2;
  }
  const prepared = prepareConnection(
    { target: args.target, apply: args.apply, confirmHost: args.confirmHost },
    env
  );
  if (!prepared.ok) {
    prepared.messages.forEach(m => console.error(m));
    return prepared.status;
  }
  const opened = await openVerifiedClient(prepared, args, 'kfbm-planned-hours');
  if (!opened.ok) {
    opened.messages.forEach(m =>
      console.error(redact(m, prepared.connectionString))
    );
    return opened.status;
  }
  const { client } = opened;
  opened.notes?.forEach(n => console.log(n));
  let code = 0;
  try {
    code =
      args.command === 'rollback'
        ? await rollback(args, client)
        : await execute(args, client);
  } catch (error) {
    console.error(
      `Failed: ${redact(error?.message ?? error, prepared.connectionString)}`
    );
    code = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
  return code;
}

async function execute(args, client) {
  const comps = (
    await client.query(
      `select c.id, c.code, c.total_hours::float8 total
         from ${S}.training_components c
         join ${S}.training_catalogs k on k.id = c.training_catalog_id
        where k.code = 'KFBM' order by c.order_index`
    )
  ).rows;
  const ucs = (
    await client.query(
      `select u.id, u.component_id, u.letter, u.planned_hours::float8 hours
         from ${S}.training_use_cases u
         join ${S}.training_components c on c.id = u.component_id
         join ${S}.training_catalogs k on k.id = c.training_catalog_id
        where k.code = 'KFBM' order by u.component_id, u.order_index, u.letter`
    )
  ).rows;
  const changes = [];
  const left = [];
  for (const c of comps) {
    const list = ucs.filter(u => u.component_id === c.id);
    if (list.length === 0) continue;
    if (!(c.total > 0)) {
      left.push({
        component: c.code,
        reason: 'no total hours',
        useCases: list.length,
      });
      continue;
    }
    const open = list.filter(u => !(u.hours > 0));
    if (open.length === 0) continue;
    // the hours of use cases that already have some are kept, the rest is shared between the open ones
    const kept = list.reduce((a, u) => a + (u.hours > 0 ? u.hours : 0), 0);
    const share = distributeHours(c.total - kept, open.length);
    if (share.length === 0) {
      left.push({
        component: c.code,
        reason: 'the hours are used up',
        useCases: open.length,
      });
      continue;
    }
    open.forEach((u, i) =>
      changes.push({
        id: u.id,
        component: c.code,
        letter: u.letter,
        old: u.hours ?? 0,
        hours: share[i],
      })
    );
  }
  const byComp = new Map();
  changes.forEach(x =>
    byComp.set(x.component, [...(byComp.get(x.component) ?? []), x.hours])
  );
  console.log(
    `Use cases to get hours: ${changes.length} in ${byComp.size} components; left out: ${left.length} components (${left.reduce((a, x) => a + x.useCases, 0)} use cases)`
  );
  for (const [code, hs] of byComp)
    console.log(
      `  ${code}: ${hs.length} use cases, ${Math.min(...hs)} to ${Math.max(...hs)} hours, sum ${hs.reduce((a, b) => a + b, 0)}`
    );
  left.forEach(x =>
    console.log(`  left out ${x.component}: ${x.reason} (${x.useCases} use cases)`)
  );
  if (args.command === 'plan' || !args.apply) {
    console.log(
      args.command === 'plan' ? 'Plan only.' : 'Dry run: nothing written.'
    );
    return 0;
  }
  await client.query('begin');
  try {
    for (const x of changes)
      await client.query(
        `update ${S}.training_use_cases set planned_hours = $1 where id = $2`,
        [x.hours, x.id]
      );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  }
  if (args.out)
    writeFileSync(args.out, JSON.stringify({ changes, left }, null, 1));
  console.log(`Done: ${changes.length} use cases got planned hours.`);
  return 0;
}

async function rollback(args, client) {
  const r = JSON.parse(readFileSync(args.source, 'utf8'));
  if (!args.apply) {
    console.log(
      `Rollback plan: ${r.changes.length} use cases get their old hours back. Nothing written (no --apply).`
    );
    return 0;
  }
  await client.query('begin');
  try {
    for (const x of r.changes)
      await client.query(
        `update ${S}.training_use_cases set planned_hours = $1 where id = $2`,
        [x.old, x.id]
      );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  }
  console.log(`Rolled back: ${r.changes.length} use cases.`);
  return 0;
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === 'kfbm-planned-hours.mjs'
) {
  main(process.argv.slice(2)).then(code => process.exit(code));
}
