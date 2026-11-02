/**
 * Who may reach an activity report (Ausbildungsnachweis), its entries and the
 * weekly evaluation that belongs to it?
 *
 * The routes under /api/activity-reports, /api/weekly-evaluations and
 * /api/grade-edit-history used to take the person from the query or the body
 * (userId, trainerId, traineeId) or had no identity at all, so a report id was
 * enough to delete a report or to set grades. The session is the only source
 * of identity now:
 *
 *  - A trainee reaches only their own reports. A report of someone else is
 *    answered like a missing one (404).
 *  - A trainer-level caller (trainer, admin, super admin) reaches the reports
 *    of a trainee inside their organization scope (scopeOrg / isInOrgScope)
 *    and, if they chose an occupation with x-catalog, inside that occupation
 *    (ensureTraineeInCatalog, through resolveTraineeForRead). Everything else
 *    is answered with 404 (403 for an occupation that is not allowed). A DRAFT
 *    is the private work of the trainee and not visible to trainer level, as
 *    in the trainer lists.
 *  - A report belongs to one occupation (activity_reports.training_catalog_id).
 *    The occupation of the REPORT counts, not the enrollments of the trainee:
 *    with an occupation chosen (x-catalog), trainer level reaches only reports
 *    of that occupation, and a list of a trainee in several occupations shows
 *    the reports of the chosen occupation only (requireReportCatalogFilter).
 *
 * The checks are a first line. Every write also carries the owner or the
 * organization in its own where condition (traineeAccessCondition and the
 * helpers below), so a record that changed between the check and the write is
 * not touched either.
 */

import { NextResponse } from 'next/server';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import db from '@/db';
import {
  activityReports,
  activityReportUseCaseEntries,
  weeklyEvaluations,
  weeklySoftskillRatings,
  profiles,
} from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import {
  isErrorResponse,
  requireUser,
  scopeOrg,
  type OrgScope,
  type RequestLike,
  type SessionUser,
} from '@/lib/auth/session';
import { resolveTraineeForRead } from '@/lib/auth/trainee-data-access';
import {
  catalogCondition,
  requestedCatalogCode,
  requireCatalogScope,
  type CatalogRequestLike,
} from '@/lib/catalog/scope';

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActivityReportRow = typeof activityReports.$inferSelect;

/** A report of someone else is answered like a missing one. */
export const reportNotFound = () =>
  NextResponse.json({ error: 'Report not found' }, { status: 404 });

/** A signed-in trainee. Trainer level gets 403: the route is a trainee action. */
export async function requireTraineeSession(
  request: RequestLike
): Promise<SessionUser | NextResponse> {
  const session = await requireUser(request);
  if (isErrorResponse(session)) return session;
  if (session.isTrainerLevel) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return session;
}

export type ReportCatalogFilter = {
  /**
   * Condition on activity_reports.training_catalog_id for a list, or null if
   * nothing is to be filtered (a single occupation without a choice, or trainer
   * level without a choice).
   */
  condition: SQL | null;
  /**
   * The occupation the caller works in, for new reports and for the checks of a
   * single report. null for trainer level without a choice.
   */
  catalogId: string | null;
};

/**
 * The occupation of a request for activity reports. A trainee in several
 * occupations works in ONE (the one named by x-catalog, otherwise the first
 * enrollment), so a list never mixes the reports of two trainings. A trainee
 * with one occupation is not filtered (the reports are all of that occupation).
 * Trainer level without a choice is not filtered (as before), with a choice
 * (x-catalog or ?catalog) only the reports of that occupation count. Returns a
 * ready-made error response for a foreign occupation (403) or a scope that
 * cannot be determined (503).
 */
export async function requireReportCatalogFilter(
  session: SessionUser,
  request: CatalogRequestLike
): Promise<ReportCatalogFilter | NextResponse> {
  if (session.isTrainerLevel && !requestedCatalogCode(request)) {
    return { condition: null, catalogId: null };
  }
  const scope = await requireCatalogScope(session, request);
  if (scope instanceof Response) return scope as NextResponse;
  return {
    condition: scope.selected
      ? catalogCondition(activityReports.trainingCatalogId, scope)
      : null,
    catalogId: scope.activeCatalogId,
  };
}

/**
 * Condition on weekly_evaluations for a chosen occupation: the evaluation
 * belongs to the occupation of the activity report it is linked to. An
 * evaluation without a report cannot be attributed and stays in every
 * occupation. undefined without a condition (nothing to filter).
 */
export function evaluationReportCatalogCondition(
  reportCatalog: SQL | null | undefined
): SQL | undefined {
  if (!reportCatalog) return undefined;
  return sql`(${weeklyEvaluations.activityReportId} is null or exists (select 1 from ${activityReports} where ${activityReports.id} = ${weeklyEvaluations.activityReportId} and ${reportCatalog}))`;
}

/**
 * Trainer level with a chosen occupation reaches only the reports of that
 * occupation: null if the report is inside, otherwise the answer for a missing
 * report (`notFound`, the words of the route) or the error of the occupation
 * check (403 for a foreign occupation, 503). Without a choice nothing is
 * checked.
 */
export async function ensureReportInChosenCatalog(
  session: SessionUser,
  request: CatalogRequestLike,
  report: { trainingCatalogId: unknown },
  notFound: () => NextResponse = reportNotFound
): Promise<NextResponse | null> {
  const filter = await requireReportCatalogFilter(session, request);
  if (isErrorResponse(filter)) return filter;
  if (
    filter.condition &&
    String(report.trainingCatalogId) !== filter.catalogId
  ) {
    return notFound();
  }
  return null;
}

/**
 * The report for a caller, or a ready-made error response (404 for a report
 * that does not exist, is not an id, belongs to someone else, lies outside the
 * organization scope or is a DRAFT seen from trainer level, 403 or 503 from the
 * occupation check).
 */
export async function loadReportForSession(
  session: SessionUser,
  request: CatalogRequestLike,
  reportId: string
): Promise<ActivityReportRow | NextResponse> {
  if (!UUID.test(reportId)) return reportNotFound();

  const [report] = await withDbRetry(() =>
    db
      .select()
      .from(activityReports)
      .where(eq(activityReports.id, reportId as any))
      .limit(1)
  );
  if (!report) return reportNotFound();

  if (!session.isTrainerLevel) {
    return String(report.traineeId) === session.id ? report : reportNotFound();
  }

  if (report.status === 'DRAFT') return reportNotFound();
  // Organization scope and role of the trainee. The occupation is not asked
  // here (an empty request): it is the one of the report, checked below, not
  // the one of the enrollments of the trainee.
  const trainee = await resolveTraineeForRead(
    session,
    {},
    String(report.traineeId)
  );
  if (isErrorResponse(trainee)) {
    return trainee.status === 404 ? reportNotFound() : trainee;
  }
  const outOfCatalog = await ensureReportInChosenCatalog(session, request, report);
  if (outOfCatalog) return outOfCatalog;
  return report;
}

/**
 * exists() over the trainee profile of `traineeIdColumn`: the trainee lies in
 * the organization scope and, if given, matches the catalog condition (a
 * condition on `profiles`). undefined means no restriction (platform-wide view
 * without a chosen occupation). A profile without an organization is outside
 * every organization scope (fail closed), like isInOrgScope.
 */
export function traineeScopeCondition(
  traineeIdColumn: PgColumn,
  org: OrgScope,
  catalogCondition: SQL | null = null
): SQL | undefined {
  const parts: SQL[] = [sql`${profiles.id} = ${traineeIdColumn}`];
  if (org.organizationId !== null) {
    parts.push(sql`${profiles.organizationId} = ${org.organizationId}::uuid`);
  }
  if (catalogCondition) parts.push(catalogCondition);
  if (parts.length === 1) return undefined;
  return sql`exists (select 1 from ${profiles} where ${sql.join(parts, sql` and `)})`;
}

/**
 * Condition for a write on a table with a trainee column: the owner for a
 * trainee, the organization scope for trainer level (undefined for the
 * platform-wide view).
 */
export function traineeAccessCondition(
  session: SessionUser,
  traineeIdColumn: PgColumn
): SQL | undefined {
  return session.isTrainerLevel
    ? traineeScopeCondition(traineeIdColumn, scopeOrg(session))
    : eq(traineeIdColumn, session.id as any);
}

/**
 * An entry of a report the caller reaches (for writes on the entries),
 * optionally only while the report has one of the given statuses.
 */
export function entryAccessCondition(
  session: SessionUser,
  statuses?: readonly string[]
): SQL {
  const access =
    traineeAccessCondition(session, activityReports.traineeId) ?? sql`true`;
  const status = statuses?.length
    ? sql` and ${inArray(activityReports.status, statuses as any)}`
    : sql``;
  return sql`exists (select 1 from ${activityReports} where ${activityReports.id} = ${activityReportUseCaseEntries.reportId} and ${access}${status})`;
}

/** Reports a trainer grades: submitted ones, and approved ones (edit). */
export const GRADABLE_STATUSES = ['SUBMITTED', 'APPROVED'] as const;

/** 409 for a report in a status that is not graded (a rejected report). */
export function notGradable(report: ActivityReportRow): NextResponse | null {
  return (GRADABLE_STATUSES as readonly string[]).includes(
    String(report.status)
  )
    ? null
    : NextResponse.json(
        { error: 'Nur eingereichte oder genehmigte Nachweise werden bewertet' },
        { status: 409 }
      );
}

/** A softskill rating of an evaluation of a trainee the caller reaches. */
export function ratingAccessCondition(session: SessionUser): SQL {
  const access =
    traineeAccessCondition(session, weeklyEvaluations.traineeId) ?? sql`true`;
  return sql`exists (select 1 from ${weeklyEvaluations} where ${weeklyEvaluations.id} = ${weeklySoftskillRatings.weeklyEvaluationId} and ${access})`;
}
