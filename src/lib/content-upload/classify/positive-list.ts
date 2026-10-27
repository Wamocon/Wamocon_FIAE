// The positive list of the assignment (docs/ki-upload-konzept.md 6.1 stage 3 and
// 6.2): the components and enablers that an assignment may name. An assignment is
// only accepted when its component and its enabler stand on this list.
//
// Where the list comes from (later, in U2, U6 and U7): the components and enablers
// of the chosen catalog in the database (origin "database"), plus the ones that the
// plan of the import would create from a preserved folder tree (origin "plan").
// This module only defines the interface and the lookups. It reads no database, so
// the tests fill it with a synthetic list.
//
// Codes follow the plan of the import: components K1, K6.2, enablers K6.2-d.

import { classifyByPath } from './path-rule';
import type { SourceGroup } from './types';

export type ListOrigin = 'database' | 'plan';

export interface PositiveEnablerInput {
  /** K6.2-d */
  code: string;
  title?: string | null;
  origin?: ListOrigin;
}

export interface PositiveComponentInput {
  /** K6.2 */
  code: string;
  title?: string | null;
  /** The group of the component, when known (teil1, teil2, wahl, ganze). */
  group?: SourceGroup | null;
  origin?: ListOrigin;
  enablers?: ReadonlyArray<PositiveEnablerInput>;
}

export interface PositiveListInput {
  components?: ReadonlyArray<PositiveComponentInput> | null;
}

export interface ComponentEntry {
  code: string;
  number: number;
  split: number | null;
  /** 06.2 */
  key: string;
  title: string | null;
  group: SourceGroup | null;
  origin: ListOrigin;
}

export interface EnablerEntry {
  code: string;
  componentCode: string;
  letter: string;
  /** 6.2d */
  key: string;
  title: string | null;
  origin: ListOrigin;
}

export type Resolution =
  | {
      status: 'unique';
      componentCode: string;
      /** Absent when a component was resolved. */
      enablerCode?: string;
      /** plan when the component or the enabler is not yet in the database */
      origin: ListOrigin;
    }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'missing' };

export interface PositiveList {
  readonly size: { components: number; enablers: number };
  /** Entries that were not valid codes and were dropped. */
  readonly rejected: number;
  /** True when the limits cut the input. */
  readonly truncated: boolean;
  component(code: string): ComponentEntry | null;
  enabler(code: string): EnablerEntry | null;
  /**
   * Resolves the code of a heading (1b, 6.2d, 6d). A code without a split can fit
   * several components; a hint (the component of the path) chooses between them.
   */
  resolveEnablerKey(key: string, hintComponentCode?: string | null): Resolution;
  /** Resolves the component key of a global quiz (06.1, 06). */
  resolveComponentKey(key: string): Resolution;
}

export const LIMITS = Object.freeze({
  components: 500,
  enablers: 5000,
  paths: 20000,
});

const COMPONENT_CODE = /^K(\d{1,2})(?:\.(\d))?$/;
const ENABLER_CODE = /^K(\d{1,2})(?:\.(\d))?-([a-z])$/;
const ENABLER_KEY = /^(\d{1,2})(?:\.(\d))?([a-z])$/;
const COMPONENT_KEY = /^(\d{1,2})(?:\.(\d))?$/;

const GROUPS: ReadonlySet<string> = new Set([
  'teil1',
  'teil2',
  'wahl',
  'ganze',
]);

const clean = (value: unknown) =>
  typeof value === 'string' ? value.normalize('NFC').trim() : '';

const componentCodeOf = (number: number, split: number | null) =>
  `K${number}${split !== null ? `.${split}` : ''}`;

const text = (value: unknown): string | null => {
  const t = clean(value);
  return t.length > 0 ? t.slice(0, 200) : null;
};

/** Origin of a resolved entry: plan as soon as one part of it is only planned. */
const combined = (a: ListOrigin, b: ListOrigin): ListOrigin =>
  a === 'plan' || b === 'plan' ? 'plan' : 'database';

export function buildPositiveList(
  ...inputs: Array<PositiveListInput | null | undefined>
): PositiveList {
  const components = new Map<string, ComponentEntry>();
  const enablers = new Map<string, EnablerEntry>();
  let rejected = 0;
  let truncated = false;

  const mergeComponent = (entry: ComponentEntry) => {
    const known = components.get(entry.code);
    if (!known) {
      if (components.size >= LIMITS.components) {
        truncated = true;
        return;
      }
      components.set(entry.code, entry);
      return;
    }
    // the database wins over the plan, and a value that is known wins over none
    const databaseFirst =
      entry.origin === 'database' && known.origin === 'plan';
    components.set(entry.code, {
      ...known,
      origin: entry.origin === 'database' ? 'database' : known.origin,
      title: databaseFirst
        ? (entry.title ?? known.title)
        : (known.title ?? entry.title),
      group: databaseFirst
        ? (entry.group ?? known.group)
        : (known.group ?? entry.group),
    });
  };

  for (const input of inputs) {
    const list =
      input && Array.isArray(input.components) ? input.components : [];
    for (const raw of list) {
      if (raw === null || typeof raw !== 'object') {
        rejected += 1;
        continue;
      }
      const code = clean(raw.code).toUpperCase();
      const match = COMPONENT_CODE.exec(code);
      if (!match) {
        rejected += 1;
        continue;
      }
      const number = Number(match[1]);
      const split = match[2] ? Number(match[2]) : null;
      const origin: ListOrigin = raw.origin === 'plan' ? 'plan' : 'database';
      mergeComponent({
        code,
        number,
        split,
        key: `${String(number).padStart(2, '0')}${split !== null ? `.${split}` : ''}`,
        title: text(raw.title),
        group: GROUPS.has(String(raw.group))
          ? (raw.group as SourceGroup)
          : null,
        origin,
      });
      const own = Array.isArray(raw.enablers) ? raw.enablers : [];
      for (const rawEnabler of own) {
        const enablerCode =
          rawEnabler && typeof rawEnabler === 'object'
            ? clean(rawEnabler.code).toLowerCase().replace(/^k/, 'K')
            : '';
        const e = ENABLER_CODE.exec(enablerCode);
        if (
          !e ||
          componentCodeOf(Number(e[1]), e[2] ? Number(e[2]) : null) !== code
        ) {
          rejected += 1;
          continue;
        }
        const enablerOrigin: ListOrigin =
          rawEnabler.origin === 'plan' ? 'plan' : 'database';
        const known = enablers.get(enablerCode);
        if (!known) {
          if (enablers.size >= LIMITS.enablers) {
            truncated = true;
            continue;
          }
          enablers.set(enablerCode, {
            code: enablerCode,
            componentCode: code,
            letter: e[3],
            key: `${number}${split !== null ? `.${split}` : ''}${e[3]}`,
            title: text(rawEnabler.title),
            origin: enablerOrigin,
          });
        } else if (enablerOrigin === 'database' && known.origin === 'plan') {
          enablers.set(enablerCode, {
            ...known,
            origin: 'database',
            title: text(rawEnabler.title) ?? known.title,
          });
        }
      }
    }
  }

  // an enabler needs its component: one that was dropped by the limit takes its
  // enablers with it
  for (const [code, entry] of enablers) {
    if (!components.has(entry.componentCode)) enablers.delete(code);
  }

  const byNumber = new Map<number, ComponentEntry[]>();
  for (const entry of components.values()) {
    byNumber.set(entry.number, [...(byNumber.get(entry.number) ?? []), entry]);
  }
  const sortedCodes = (entries: Array<{ code: string }>) =>
    entries.map(e => e.code).sort();

  const originOf = (enabler: EnablerEntry): ListOrigin =>
    combined(
      enabler.origin,
      components.get(enabler.componentCode)?.origin ?? 'plan'
    );

  return {
    size: { components: components.size, enablers: enablers.size },
    rejected,
    truncated,
    component: code => components.get(clean(code).toUpperCase()) ?? null,
    enabler: code =>
      enablers.get(clean(code).toLowerCase().replace(/^k/, 'K')) ?? null,
    resolveEnablerKey(key, hintComponentCode) {
      const m = ENABLER_KEY.exec(clean(key).toLowerCase());
      if (!m) return { status: 'missing' };
      const number = Number(m[1]);
      const split = m[2] ? Number(m[2]) : null;
      const letter = m[3];
      let candidates: EnablerEntry[];
      if (split !== null) {
        const exact = enablers.get(
          `${componentCodeOf(number, split)}-${letter}`
        );
        candidates = exact ? [exact] : [];
      } else {
        candidates = (byNumber.get(number) ?? [])
          .map(component => enablers.get(`${component.code}-${letter}`))
          .filter((e): e is EnablerEntry => e !== undefined);
      }
      if (candidates.length === 0) return { status: 'missing' };
      if (candidates.length > 1 && hintComponentCode) {
        const hint = clean(hintComponentCode).toUpperCase();
        const chosen = candidates.filter(c => c.componentCode === hint);
        if (chosen.length === 1) candidates = chosen;
      }
      if (candidates.length > 1) {
        return { status: 'ambiguous', candidates: sortedCodes(candidates) };
      }
      const [only] = candidates;
      return {
        status: 'unique',
        componentCode: only.componentCode,
        enablerCode: only.code,
        origin: originOf(only),
      };
    },
    resolveComponentKey(key) {
      const m = COMPONENT_KEY.exec(clean(key));
      if (!m) return { status: 'missing' };
      const number = Number(m[1]);
      const split = m[2] ? Number(m[2]) : null;
      const found =
        split !== null
          ? [components.get(componentCodeOf(number, split))].filter(
              (c): c is ComponentEntry => c !== undefined
            )
          : (byNumber.get(number) ?? []);
      if (found.length === 0) return { status: 'missing' };
      if (found.length > 1) {
        return { status: 'ambiguous', candidates: sortedCodes(found) };
      }
      return {
        status: 'unique',
        componentCode: found[0].code,
        origin: found[0].origin,
      };
    },
  };
}

/**
 * What the plan of the import would create from a folder tree: the components and
 * enablers that the folders of the uploaded paths name, marked as "plan". Paths
 * without the structure of the source tree and archive files add nothing.
 */
export function positiveListFromPaths(
  relPaths: ReadonlyArray<string>
): PositiveListInput {
  const components = new Map<
    string,
    {
      code: string;
      title: string | null;
      group: SourceGroup | null;
      enablers: Set<string>;
    }
  >();
  for (const path of (relPaths ?? []).slice(0, LIMITS.paths)) {
    const result = classifyByPath(path);
    if (result.kind !== 'match' || !result.componentCode) continue;
    const entry = components.get(result.componentCode) ?? {
      code: result.componentCode,
      title: null,
      group: null,
      enablers: new Set<string>(),
    };
    entry.title ??= result.componentTitle;
    // the group folder of the global quizzes says nothing about the component
    if (result.group && result.group !== 'global') entry.group ??= result.group;
    if (result.enablerCode) entry.enablers.add(result.enablerCode);
    components.set(result.componentCode, entry);
  }
  const order = (code: string) => {
    const m = COMPONENT_CODE.exec(code);
    return m ? Number(m[1]) * 10 + Number(m[2] ?? 0) : 0;
  };
  return {
    components: [...components.values()]
      .sort((a, b) => order(a.code) - order(b.code))
      .map(entry => ({
        code: entry.code,
        title: entry.title,
        group: entry.group,
        origin: 'plan' as const,
        enablers: [...entry.enablers].sort().map(code => ({
          code,
          origin: 'plan' as const,
        })),
      })),
  };
}
