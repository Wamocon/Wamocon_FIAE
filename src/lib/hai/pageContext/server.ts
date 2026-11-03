/**
 * Server side of the page context: switch, check of the ids against the access
 * rules, and the ready-made value for the pipeline.
 *
 * The browser text is data. What the server takes from it:
 *  - the shape-checked, cleaned title and labels (sanitize.ts), as data for
 *    "this page" references, never as a right or a source
 *  - ids only after they passed the same check as enablerId and courseId of the
 *    request: the record must lie in an occupation (catalog) of the person; a
 *    trainee id of a trainer page must be an own, assigned trainee. An id of a
 *    foreign occupation or organization, of an unknown record or of a kind the
 *    server cannot check is dropped without an error. The titles of checked
 *    records come from the database, not from the page.
 *
 * Switch HAI_PAGE_CONTEXT: "on" and "off" are explicit. Without a value the
 * context is ON everywhere except Production, where it is OFF until the go-live
 * (docs/go-checkliste.md). With the switch off nothing of the page is read and
 * the prompt is byte for byte the one without this feature.
 *
 * @module lib/hai/pageContext/server
 */

import { and, eq, inArray } from 'drizzle-orm';
import db from '@/db';
import {
  courses,
  enablers,
  profiles,
  useCases,
} from '@/db/migrations/schemas/schema';
import { isTrainerLevelRole } from '@/lib/auth/roles';
import { cleanPageContext, type CleanPageContext } from './sanitize';

export const PAGE_CONTEXT_ENV = 'HAI_PAGE_CONTEXT';

type Env = Record<string, string | undefined>;

/**
 * Whether the page context is used in this environment. Pure, takes the
 * environment as an argument so a test can try every case.
 *
 *  - HAI_PAGE_CONTEXT=off (or false, 0): off everywhere
 *  - HAI_PAGE_CONTEXT=on (or true, 1): on everywhere
 *  - not set: off in Production (Vercel production, or a production build
 *    outside of Vercel), on everywhere else (Preview, local, tests)
 */
export function isPageContextEnabled(env: Env = process.env): boolean {
  const value = String(env[PAGE_CONTEXT_ENV] ?? '')
    .trim()
    .toLowerCase();
  if (['off', 'false', '0', 'no'].includes(value)) return false;
  if (['on', 'true', '1', 'yes'].includes(value)) return true;
  const vercel = String(env.VERCEL_ENV ?? '')
    .trim()
    .toLowerCase();
  const node = String(env.NODE_ENV ?? '')
    .trim()
    .toLowerCase();
  if (vercel === 'production') return false;
  if (vercel === '' && node === 'production') return false;
  return true;
}

/** A record of the page that passed the access check, with its title from the database. */
export interface PageEntity {
  type: 'enabler' | 'use_case' | 'course' | 'trainee';
  id: string;
  /** Title from the database (a trainee has none: names never go into this block). */
  title?: string;
}

/** The page context as the pipeline gets it. */
export interface ResolvedPageContext {
  path: string;
  kind: CleanPageContext['kind'];
  title: string;
  visibleLabels: string[];
  /** Records of the page that the person may open (ids are checked). */
  entities: PageEntity[];
}

export interface PageAccess {
  userId: string;
  /** Role from the database. */
  role: string | null | undefined;
  /** Occupations the person may read (the same list as for enablerId). */
  catalogIds: string[] | null | undefined;
}

/**
 * Check the ids of the page against the access rules. Only records in an
 * occupation of the person count; the rest is dropped. Never throws: a failed
 * lookup drops the ids (fail closed).
 */
export async function checkPageIds(
  ids: string[],
  access: PageAccess
): Promise<PageEntity[]> {
  if (ids.length === 0) return [];
  const catalogIds = access.catalogIds ?? [];
  const entities: PageEntity[] = [];
  try {
    if (catalogIds.length > 0) {
      const allowed = (catalogId: unknown) =>
        catalogIds.includes(String(catalogId));

      const [enablerRows, useCaseRows, courseRows] = await Promise.all([
        db
          .select({
            id: enablers.id,
            title: enablers.title,
            trainingCatalogId: enablers.trainingCatalogId,
          })
          .from(enablers)
          .where(inArray(enablers.id, ids)),
        db
          .select({
            id: useCases.id,
            title: useCases.title,
            trainingCatalogId: useCases.trainingCatalogId,
          })
          .from(useCases)
          .where(inArray(useCases.id, ids)),
        db
          .select({
            id: courses.id,
            title: courses.title,
            trainingCatalogId: courses.trainingCatalogId,
          })
          .from(courses)
          .where(inArray(courses.id, ids)),
      ]);
      for (const r of enablerRows) {
        if (allowed(r.trainingCatalogId)) {
          entities.push({ type: 'enabler', id: String(r.id), title: r.title });
        }
      }
      for (const r of useCaseRows) {
        if (allowed(r.trainingCatalogId)) {
          entities.push({ type: 'use_case', id: String(r.id), title: r.title });
        }
      }
      for (const r of courseRows) {
        if (allowed(r.trainingCatalogId)) {
          entities.push({ type: 'course', id: String(r.id), title: r.title });
        }
      }
    }

    // A trainee id counts only for a trainer level role and only for an own,
    // assigned and active trainee
    if (isTrainerLevelRole(access.role)) {
      const traineeRows = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(
          and(
            inArray(profiles.id, ids),
            eq(profiles.role, 'TRAINEE'),
            eq(profiles.assignedTrainerId, access.userId),
            eq(profiles.isActive, true)
          )
        );
      for (const r of traineeRows) {
        entities.push({ type: 'trainee', id: String(r.id) });
      }
    }
  } catch (error) {
    console.warn('HAI.ai page context: id check failed, ids dropped:', error);
    return [];
  }
  return entities;
}

/**
 * The page context of a request, ready for the pipeline, or null: switch off,
 * nothing sent, a shape that does not pass (too long, wrong kind, a kind that
 * does not fit the path, bad path). Nothing here ever raises an error to the
 * client, a bad context is simply not used.
 */
export async function resolvePageContext(
  raw: unknown,
  access: PageAccess,
  env: Env = process.env
): Promise<ResolvedPageContext | null> {
  if (raw === undefined || raw === null) return null;
  if (!isPageContextEnabled(env)) return null;
  const clean = cleanPageContext(raw);
  if (!clean) return null;
  const entities = await checkPageIds(clean.ids, access);
  return {
    path: clean.path,
    kind: clean.kind,
    title: clean.title,
    visibleLabels: clean.visibleLabels,
    entities,
  };
}
