/**
 * HAI.ai Action Execution System
 *
 * Enables HAI to perform write operations on the platform.
 * This transforms HAI from a read-only assistant to a full platform agent.
 *
 * Action Flow:
 * 1. Detect action intent from user message
 * 2. Extract parameters needed for the action
 * 3. Propose the action to the person (the pipeline never executes a write)
 * 4. After the explicit confirmation, /api/hai/action calls executeAction
 * 5. executeAction checks role, responsibility and parameters again, then
 *    executes the action via platform APIs
 *
 * @module lib/hai/actions
 */

import db from '@/db';
import { eq, and, or, isNull, sql } from 'drizzle-orm';
import {
    activityReports,
    courseMembers,
    enablerCompletions,
    quizSubmissions,
    notifications,
    enablerSubmissions,
    profiles,
    enablers
} from '@/db/migrations/schemas/schema';
import { getTrainingPhase } from '@/lib/ausbildung/duration';
import { getUserOrgIdStrict } from '@/lib/auth-helpers';
import { isInOrgScope, scopeOrg, type SessionUser } from '@/lib/auth/session';
import { loadPhasePlanForUser } from '@/lib/catalog/phase-plan-db';
import type { CatalogRequestLike } from '@/lib/catalog/scope';
import {
    ensureContentAllowed,
    fail,
    notFound,
    requireResponsibleTrainer,
    unavailable,
} from './actionGuards';
import {
    isActionAllowedForRole,
    isWriteAction,
    sanitizeActionParameters,
} from './actionPolicy';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Supported action types that HAI can perform
 */
export type ActionType =
    // Trainee actions
    | 'create_activity_report'
    | 'submit_activity_report'
    | 'complete_enabler'
    | 'submit_quiz'
    | 'mark_notification_read'
    | 'upload_document'
    // Trainer actions
    | 'approve_submission'
    | 'reject_submission'
    | 'approve_report'
    | 'reject_report'
    | 'grade_quiz'
    // Info actions (no write)
    | 'show_progress'
    | 'show_calendar'
    | 'show_reports';

/**
 * Action intent detected from user message
 */
export interface ActionIntent {
    type: ActionType;
    confidence: number; // 0-1, how confident we are about this intent
    parameters: Record<string, unknown>;
    /** Kept for callers, every write is confirmed (see actionPolicy.ts). */
    requiresConfirmation: boolean;
}

/**
 * Result of an executed action
 */
export interface ActionResult {
    success: boolean;
    message: string; // Human-readable message for HAI to narrate
    data?: unknown;
    error?: string;
    /** Why the action failed, the route maps it to the HTTP status. */
    code?: ActionFailureCode;
}

/**
 * invalid: parameters or type not accepted, forbidden: role or occupation not
 * allowed, not_found: missing or foreign record, conflict: state does not fit,
 * unavailable: the scope could not be checked, error: unexpected failure.
 */
export type ActionFailureCode =
    | 'invalid'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'unavailable'
    | 'error';

/**
 * Context for action detection
 */
export interface ActionDetectionContext {
    userRole: 'TRAINER' | 'TRAINEE';
    currentEnablerId?: string;
    currentCourseId?: string;
    conversationHistory?: string[];
}

// ============================================================================
// ACTION INTENT DETECTION
// ============================================================================

/**
 * Detect if the user message contains an action intent
 *
 * @param message - User's message
 * @param context - Current context
 * @returns ActionIntent if detected, null otherwise
 */
export function detectActionIntent(
    message: string,
    context: ActionDetectionContext
): ActionIntent | null {
    // --- Trainee Actions ---

    // Create activity report
    if (
        /erstell.*(tätigkeitsnachweis|nachweis|bericht|wochenbericht)/i.test(message) ||
        /schreib.*(tätigkeitsnachweis|nachweis|bericht)/i.test(message) ||
        /neu.*(tätigkeitsnachweis|nachweis|bericht)/i.test(message)
    ) {
        return {
            type: 'create_activity_report',
            confidence: 0.9,
            parameters: extractReportParameters(message),
            requiresConfirmation: true,
        };
    }

    // Submit activity report
    if (
        /reich.*(tätigkeitsnachweis|nachweis|bericht).*ein/i.test(message) ||
        /submit.*(report|nachweis)/i.test(message) ||
        /abgeben.*(tätigkeitsnachweis|nachweis|bericht)/i.test(message)
    ) {
        return {
            type: 'submit_activity_report',
            confidence: 0.85,
            parameters: extractReportParameters(message),
            requiresConfirmation: true,
        };
    }

    // Complete enabler
    if (
        /schließ.*(enabler|modul|aufgabe).*ab/i.test(message) ||
        /mark.*enabler.*complete/i.test(message) ||
        /enabler.*(fertig|erledigt|abgeschlossen)/i.test(message) ||
        /(fertig|erledigt|abgeschlossen).*(enabler|modul)/i.test(message)
    ) {
        return {
            type: 'complete_enabler',
            confidence: 0.8,
            parameters: { enablerId: context.currentEnablerId },
            requiresConfirmation: true,
        };
    }

    // Submit quiz
    if (
        /submit.*quiz/i.test(message) ||
        /reich.*quiz.*ein/i.test(message) ||
        /quiz.*(abgeben|absenden)/i.test(message)
    ) {
        return {
            type: 'submit_quiz',
            confidence: 0.75,
            parameters: extractQuizParameters(message),
            requiresConfirmation: true,
        };
    }

    // Mark notification read
    if (
        /mark.*(notification|benachrichtigung).*read/i.test(message) ||
        /benachrichtigung.*(gelesen|lesen)/i.test(message) ||
        /lösch.*benachrichtigung/i.test(message)
    ) {
        return {
            type: 'mark_notification_read',
            confidence: 0.7,
            parameters: extractNotificationParameters(message),
            requiresConfirmation: true,
        };
    }

    // --- Trainer Actions ---

    if (context.userRole === 'TRAINER') {
        // Approve submission
        if (
            /genehmig.*(submission|einreichung|abgabe)/i.test(message) ||
            /approve.*submission/i.test(message) ||
            /(akzeptier|bestätig).*(submission|einreichung)/i.test(message)
        ) {
            return {
                type: 'approve_submission',
                confidence: 0.85,
                parameters: extractSubmissionParameters(message),
                requiresConfirmation: true,
            };
        }

        // Approve report
        if (
            /genehmig.*(nachweis|bericht|report)/i.test(message) ||
            /approve.*report/i.test(message) ||
            /(akzeptier|bestätig).*(nachweis|bericht)/i.test(message)
        ) {
            return {
                type: 'approve_report',
                confidence: 0.85,
                parameters: extractReportParameters(message),
                requiresConfirmation: true,
            };
        }

        // Grade quiz
        if (
            /bewert.*quiz/i.test(message) ||
            /grade.*quiz/i.test(message) ||
            /quiz.*(bewerten|benoten)/i.test(message)
        ) {
            return {
                type: 'grade_quiz',
                confidence: 0.75,
                parameters: extractQuizParameters(message),
                requiresConfirmation: true,
            };
        }
    }

    return null;
}

// ============================================================================
// PARAMETER EXTRACTION
// ============================================================================

function extractReportParameters(message: string): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    // Extract week number (KW XX or Woche XX)
    const weekMatch = message.match(/(?:kw|woche)\s*(\d+)/i);
    if (weekMatch) {
        params.weekNumber = parseInt(weekMatch[1], 10);
    }

    // Extract year
    const yearMatch = message.match(/\b(20\d{2})\b/);
    if (yearMatch) {
        params.year = parseInt(yearMatch[1], 10);
    }

    return params;
}

function extractQuizParameters(message: string): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    // Extract quiz ID if mentioned
    const idMatch = message.match(/quiz[:\s]*([a-f0-9-]{36})/i);
    if (idMatch) {
        params.quizId = idMatch[1];
    }

    return params;
}

function extractNotificationParameters(message: string): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    // Check if "all" notifications
    if (/alle/i.test(message)) {
        params.markAll = true;
    }

    return params;
}

function extractSubmissionParameters(message: string): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    // Extract submission ID if mentioned
    const idMatch = message.match(/submission[:\s]*([a-f0-9-]{36})/i);
    if (idMatch) {
        params.submissionId = idMatch[1];
    }

    return params;
}

// ============================================================================
// ACTION EXECUTION
// ============================================================================

/**
 * Execute a confirmed action on behalf of the person of the session.
 *
 * Only the confirmed call of /api/hai/action reaches this function, the
 * pipeline never calls it. Every write is checked again here (nothing the
 * proposal showed is trusted): the type must be on the list, the role must fit
 * the type, the parameters are whitelisted, and the records must belong to the
 * trainee or lie inside the organization and occupation the trainer is
 * responsible for. Anything unclear stops the action (fail closed). A failure
 * carries a code and a plain message, never raw database details.
 *
 * @param actionType - The action to perform
 * @param parameters - Action parameters (whitelisted here)
 * @param actor - The person of the session (id, role and organization come
 *                from the database through the session layer)
 * @param request - The request, for the chosen occupation (x-catalog)
 * @returns Result of the action
 */
export async function executeAction(
    actionType: ActionType,
    parameters: Record<string, unknown>,
    actor: SessionUser,
    request?: CatalogRequestLike | null
): Promise<ActionResult> {
    try {
        if (!isWriteAction(actionType)) {
            return fail(
                'invalid',
                'Diese Aktion wird nicht unterstützt.',
                'Action not supported'
            );
        }

        const audience = actor.isTrainerLevel ? 'TRAINER' : 'TRAINEE';
        if (!isActionAllowedForRole(actionType, audience)) {
            return fail(
                'forbidden',
                audience === 'TRAINER'
                    ? 'Diese Aktion ist nur für Auszubildende möglich.'
                    : 'Diese Aktion ist nur für Trainer möglich.',
                'Permission denied'
            );
        }

        // A trainer-level person acts inside an organization that must be known
        // (a profile without one would silently count as the platform organization)
        if (audience === 'TRAINER') {
            try {
                await getUserOrgIdStrict(actor.id);
            } catch (error) {
                console.error('HAI.ai: organization of the trainer unknown:', error);
                return unavailable();
            }
        }

        const checked = sanitizeActionParameters(actionType, parameters);
        if (!checked.ok) {
            return fail('invalid', checked.message, 'Invalid parameters');
        }
        const params = checked.parameters;

        // Route to specific action handler
        switch (actionType) {
            case 'create_activity_report':
                return await createActivityReport(actor.id, params);

            case 'submit_activity_report':
                return await submitActivityReport(actor.id, params);

            case 'complete_enabler':
                return await completeEnabler(actor, params, request);

            case 'mark_notification_read':
                return await markNotificationRead(actor.id, params);

            case 'approve_submission':
                return await approveSubmission(actor, params, request);

            case 'approve_report':
                return await approveReport(actor, params, request);

            case 'grade_quiz':
                return await gradeQuiz(actor, params, request);
        }
    } catch (error) {
        console.error(`HAI.ai: Action execution error (${actionType}):`, error);
        return fail(
            'error',
            'Ein Fehler ist aufgetreten beim Ausführen der Aktion.',
            'Action failed'
        );
    }
}

// ============================================================================
// TRAINEE ACTIONS
// ============================================================================

/**
 * Create a new activity report (Tätigkeitsnachweis)
 */
async function createActivityReport(
    userId: string,
    parameters: Record<string, unknown>
): Promise<ActionResult> {
    try {
        // Determine week and year
        const now = new Date();
        const weekNumber = (parameters.weekNumber as number) || getWeekNumber(now);
        const year = (parameters.year as number) || now.getFullYear();

        // Check if report for this week already exists
        const existing = await db
            .select({ id: activityReports.id })
            .from(activityReports)
            .where(
                and(
                    eq(activityReports.traineeId, userId),
                    eq(activityReports.weekNumber, weekNumber),
                    eq(activityReports.year, year)
                )
            )
            .limit(1);

        if (existing.length > 0) {
            return fail(
                'conflict',
                `Ein Tätigkeitsnachweis für KW ${weekNumber}/${year} existiert bereits.`,
                'Report already exists'
            );
        }

        // Calculate period dates (Monday to Sunday of the week)
        const periodStart = getWeekStartDate(weekNumber, year);
        const periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + 6);

        const [profile] = await db
            .select({
                startOfTrainingDate: profiles.startOfTrainingDate,
                ausbildungDurationYears: profiles.ausbildungDurationYears,
            })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        // Phase one of the trainee's occupation (KfBM 15 months, FIAE 18)
        const phasePlan = profile?.startOfTrainingDate
            ? await loadPhasePlanForUser(userId, profile.ausbildungDurationYears)
            : null;
        const ausbildungsjahr = profile?.startOfTrainingDate
            ? getTrainingPhase(
                profile.startOfTrainingDate,
                profile.ausbildungDurationYears,
                periodStart,
                phasePlan?.phaseMonths[0]
            )
            : 1;

        // A write never falls back to the platform organization
        const organizationId = await getUserOrgIdStrict(userId);

        // Create the report as DRAFT
        const newReport = await db
            .insert(activityReports)
            .values({
                traineeId: userId,
                weekNumber,
                year,
                ausbildungsjahr,
                periodStart,
                periodEnd,
                status: 'DRAFT',
                organizationId,
            })
            .returning({ id: activityReports.id });

        return {
            success: true,
            message: `📝 **Tätigkeitsnachweis erstellt!**\n\n✅ KW ${weekNumber}/${year} wurde als Entwurf gespeichert.\n\n💡 **Nächste Schritte:**\n- Öffne den Nachweis und füge deine Tätigkeiten hinzu\n- Wenn fertig: "Reiche meinen Tätigkeitsnachweis ein"`,
            data: { reportId: newReport[0].id, weekNumber, year },
        };
    } catch (error) {
        console.error('HAI.ai: Error creating activity report:', error);
        return fail(
            'error',
            'Fehler beim Erstellen des Tätigkeitsnachweises.',
            'Action failed'
        );
    }
}

/**
 * Submit an activity report for review
 */
async function submitActivityReport(
    userId: string,
    parameters: Record<string, unknown>
): Promise<ActionResult> {
    try {
        const reportId = parameters.reportId as string | undefined;
        const weekNumber = parameters.weekNumber as number | undefined;

        let reportToSubmit;

        if (reportId) {
            // Submit specific report by ID
            reportToSubmit = await db
                .select({ id: activityReports.id, status: activityReports.status, weekNumber: activityReports.weekNumber })
                .from(activityReports)
                .where(
                    and(
                        eq(activityReports.id, reportId),
                        eq(activityReports.traineeId, userId)
                    )
                )
                .limit(1);
        } else if (weekNumber) {
            // Submit report for specific week
            const year = (parameters.year as number) || new Date().getFullYear();
            reportToSubmit = await db
                .select({ id: activityReports.id, status: activityReports.status, weekNumber: activityReports.weekNumber })
                .from(activityReports)
                .where(
                    and(
                        eq(activityReports.traineeId, userId),
                        eq(activityReports.weekNumber, weekNumber),
                        eq(activityReports.year, year)
                    )
                )
                .limit(1);
        } else {
            // Submit most recent draft
            reportToSubmit = await db
                .select({ id: activityReports.id, status: activityReports.status, weekNumber: activityReports.weekNumber })
                .from(activityReports)
                .where(
                    and(
                        eq(activityReports.traineeId, userId),
                        eq(activityReports.status, 'DRAFT')
                    )
                )
                .orderBy(sql`created_at DESC`)
                .limit(1);
        }

        if (reportToSubmit.length === 0) {
            return fail(
                'not_found',
                'Kein Tätigkeitsnachweis zum Einreichen gefunden.',
                'Report not found'
            );
        }

        const report = reportToSubmit[0];

        if (report.status !== 'DRAFT') {
            return fail(
                'conflict',
                `Der Tätigkeitsnachweis wurde bereits eingereicht (Status: ${report.status}).`,
                'Report already submitted'
            );
        }

        // Update status to SUBMITTED, only the own draft
        const updated = await db
            .update(activityReports)
            .set({
                status: 'SUBMITTED',
                submittedAt: new Date(),
            })
            .where(
                and(
                    eq(activityReports.id, report.id),
                    eq(activityReports.traineeId, userId),
                    eq(activityReports.status, 'DRAFT')
                )
            )
            .returning({ id: activityReports.id });

        if (updated.length === 0) {
            return fail(
                'conflict',
                'Der Tätigkeitsnachweis hat sich geändert. Bitte versuche es erneut.',
                'Report changed'
            );
        }

        return {
            success: true,
            message: `📤 **Tätigkeitsnachweis eingereicht!**\n\n✅ KW ${report.weekNumber} wurde zur Prüfung eingereicht.`,
            data: { reportId: report.id },
        };
    } catch (error) {
        console.error('HAI.ai: Error submitting activity report:', error);
        return fail(
            'error',
            'Fehler beim Einreichen des Tätigkeitsnachweises.',
            'Action failed'
        );
    }
}

/**
 * Mark an enabler as completed. The enabler must lie inside the occupation of
 * the trainee and belong to a course the trainee is a member of.
 */
async function completeEnabler(
    actor: SessionUser,
    parameters: Record<string, unknown>,
    request?: CatalogRequestLike | null
): Promise<ActionResult> {
    try {
        const userId = actor.id;
        const enablerId = parameters.enablerId as string;

        const outOfScope = await ensureContentAllowed(
            actor,
            request,
            'enabler',
            enablerId
        );
        if (outOfScope) return outOfScope;

        const [enabler] = await db
            .select({
                id: enablers.id,
                title: enablers.title,
                courseId: enablers.courseId,
                isActive: enablers.isActive,
            })
            .from(enablers)
            .where(eq(enablers.id, enablerId))
            .limit(1);

        if (!enabler || !enabler.isActive) return notFound();

        // The trainee has to be a member of the course of the enabler
        const [member] = await db
            .select({ userId: courseMembers.userId })
            .from(courseMembers)
            .where(
                and(
                    eq(courseMembers.courseId, enabler.courseId),
                    eq(courseMembers.userId, userId)
                )
            )
            .limit(1);

        if (!member) return notFound();

        // Check if already completed
        const existing = await db
            .select({ traineeId: enablerCompletions.traineeId })
            .from(enablerCompletions)
            .where(
                and(
                    eq(enablerCompletions.traineeId, userId),
                    eq(enablerCompletions.enablerId, enablerId)
                )
            )
            .limit(1);

        const alreadyCompleted = fail(
            'conflict',
            `Der Enabler "${enabler.title}" wurde bereits als abgeschlossen markiert.`,
            'Already completed'
        );
        if (existing.length > 0) return alreadyCompleted;

        // Mark as completed
        const inserted = await db
            .insert(enablerCompletions)
            .values({
                traineeId: userId,
                enablerId,
                completedAt: new Date(),
            })
            .onConflictDoNothing()
            .returning({ enablerId: enablerCompletions.enablerId });

        if (inserted.length === 0) return alreadyCompleted;

        return {
            success: true,
            message: `🎉 **Glückwunsch!**\n\n✅ "${enabler.title}" wurde als abgeschlossen markiert.\n\n🚀 Weiter so! Dein Fortschritt wurde aktualisiert.`,
            data: { enablerId, enablerTitle: enabler.title },
        };
    } catch (error) {
        console.error('HAI.ai: Error completing enabler:', error);
        return fail(
            'error',
            'Fehler beim Abschließen des Enablers.',
            'Action failed'
        );
    }
}

/**
 * Mark notification(s) as read
 */
async function markNotificationRead(
    userId: string,
    parameters: Record<string, unknown>
): Promise<ActionResult> {
    try {
        const markAll = parameters.markAll as boolean | undefined;
        const notificationId = parameters.notificationId as string | undefined;

        if (markAll) {
            // Mark all unread notifications as read
            await db
                .update(notifications)
                .set({ isRead: true, readAt: new Date() })
                .where(
                    and(
                        eq(notifications.userId, userId),
                        eq(notifications.isRead, false)
                    )
                );

            return {
                success: true,
                message: '✓ **Alle Benachrichtigungen gelesen!**\n\nDein Postfach ist jetzt leer. 📬',
            };
        } else if (notificationId) {
            // Mark specific notification as read
            await db
                .update(notifications)
                .set({ isRead: true, readAt: new Date() })
                .where(
                    and(
                        eq(notifications.id, notificationId),
                        eq(notifications.userId, userId)
                    )
                );

            return {
                success: true,
                message: '✓ **Benachrichtigung gelesen!**',
            };
        } else {
            return fail(
                'invalid',
                'Bitte gib an, welche Benachrichtigung(en) markiert werden sollen.',
                'Missing parameters'
            );
        }
    } catch (error) {
        console.error('HAI.ai: Error marking notification read:', error);
        return fail(
            'error',
            'Fehler beim Markieren der Benachrichtigung.',
            'Action failed'
        );
    }
}

// ============================================================================
// TRAINER ACTIONS
// ============================================================================

/**
 * Approve an enabler submission. The trainee must belong to the organization
 * (and the chosen occupation) of the trainer, the enabler must lie inside the
 * catalogs of the trainer. Only an open submission can be approved.
 */
async function approveSubmission(
    actor: SessionUser,
    parameters: Record<string, unknown>,
    request?: CatalogRequestLike | null
): Promise<ActionResult> {
    try {
        const submissionId = parameters.submissionId as string;

        const [submission] = await db
            .select({
                id: enablerSubmissions.id,
                status: enablerSubmissions.status,
                traineeId: enablerSubmissions.traineeId,
                enablerId: enablerSubmissions.enablerId,
                organizationId: enablerSubmissions.organizationId,
            })
            .from(enablerSubmissions)
            .where(eq(enablerSubmissions.id, submissionId))
            .limit(1);

        if (!submission) return notFound();

        const notResponsible = await requireResponsibleTrainer(
            actor,
            request,
            String(submission.traineeId)
        );
        if (notResponsible) return notResponsible;

        if (!isInOrgScope(scopeOrg(actor), String(submission.organizationId))) {
            return notFound();
        }

        const outOfScope = await ensureContentAllowed(
            actor,
            request,
            'enabler',
            String(submission.enablerId)
        );
        if (outOfScope) return outOfScope;

        if (submission.status !== 'PENDING') {
            return fail(
                'conflict',
                `Die Abgabe kann nicht genehmigt werden (Status: ${submission.status}). Nur offene Abgaben können genehmigt werden.`,
                'Invalid submission status'
            );
        }

        // Update submission status, only of this trainee, organization and state
        const updated = await db
            .update(enablerSubmissions)
            .set({
                status: 'APPROVED',
                reviewedAt: new Date(),
                reviewedById: actor.id,
            })
            .where(
                and(
                    eq(enablerSubmissions.id, submissionId),
                    eq(enablerSubmissions.traineeId, submission.traineeId),
                    eq(enablerSubmissions.organizationId, submission.organizationId),
                    eq(enablerSubmissions.status, 'PENDING')
                )
            )
            .returning({ id: enablerSubmissions.id });

        if (updated.length === 0) {
            return fail(
                'conflict',
                'Die Abgabe hat sich geändert. Bitte versuche es erneut.',
                'Submission changed'
            );
        }

        return {
            success: true,
            message: '✅ **Abgabe genehmigt!**',
            data: { submissionId },
        };
    } catch (error) {
        console.error('HAI.ai: Error approving submission:', error);
        return fail(
            'error',
            'Fehler beim Genehmigen der Abgabe.',
            'Action failed'
        );
    }
}

/**
 * Approve an activity report. Besides the organization and occupation scope
 * the trainer has to be the trainer assigned to the trainee.
 */
async function approveReport(
    actor: SessionUser,
    parameters: Record<string, unknown>,
    request?: CatalogRequestLike | null
): Promise<ActionResult> {
    try {
        const trainerId = actor.id;
        const reportId = parameters.reportId as string;

        // Fetch report with trainee assignment info
        const reportRows = await db
            .select({
                id: activityReports.id,
                status: activityReports.status,
                traineeId: activityReports.traineeId,
                assignedTrainerId: profiles.assignedTrainerId,
            })
            .from(activityReports)
            .innerJoin(profiles, eq(activityReports.traineeId, profiles.id))
            .where(eq(activityReports.id, reportId))
            .limit(1);

        if (reportRows.length === 0) return notFound();

        const report = reportRows[0];

        // Security: organization and occupation scope of the trainee
        const notResponsible = await requireResponsibleTrainer(
            actor,
            request,
            String(report.traineeId)
        );
        if (notResponsible) return notResponsible;

        // Security: verify trainer is assigned to this trainee
        if (report.assignedTrainerId !== trainerId) return notFound();

        // Validate workflow state
        if (report.status !== 'SUBMITTED') {
            return fail(
                'conflict',
                `Der Tätigkeitsnachweis kann nicht genehmigt werden (Status: ${report.status}). Nur eingereichte Nachweise können genehmigt werden.`,
                'Invalid report status'
            );
        }

        // Update report status, only of this trainee and state
        const updated = await db
            .update(activityReports)
            .set({
                status: 'APPROVED',
                reviewedAt: new Date(),
                reviewerId: trainerId,
            })
            .where(
                and(
                    eq(activityReports.id, reportId),
                    eq(activityReports.traineeId, report.traineeId),
                    eq(activityReports.status, 'SUBMITTED')
                )
            )
            .returning({ id: activityReports.id });

        if (updated.length === 0) {
            return fail(
                'conflict',
                'Der Tätigkeitsnachweis hat sich geändert. Bitte versuche es erneut.',
                'Report changed'
            );
        }

        return {
            success: true,
            message: '✅ **Tätigkeitsnachweis genehmigt!**',
            data: { reportId },
        };
    } catch (error) {
        console.error('HAI.ai: Error approving report:', error);
        return fail(
            'error',
            'Fehler beim Genehmigen des Tätigkeitsnachweises.',
            'Action failed'
        );
    }
}

/**
 * Grade a quiz submission. The score is a whole percentage from 0 to 100 (the
 * app stores the rounded share of correct answers). The trainee must belong to
 * the organization (and the chosen occupation) of the trainer, the quiz must
 * lie inside the catalogs of the trainer, a graded submission stays as it is.
 */
async function gradeQuiz(
    actor: SessionUser,
    parameters: Record<string, unknown>,
    request?: CatalogRequestLike | null
): Promise<ActionResult> {
    try {
        const submissionId = parameters.submissionId as string;
        const score = parameters.score as number;

        const [submission] = await db
            .select({
                id: quizSubmissions.id,
                traineeId: quizSubmissions.traineeId,
                quizId: quizSubmissions.quizId,
                organizationId: quizSubmissions.organizationId,
                isReviewed: quizSubmissions.isReviewed,
            })
            .from(quizSubmissions)
            .where(eq(quizSubmissions.id, submissionId))
            .limit(1);

        if (!submission) return notFound();

        const notResponsible = await requireResponsibleTrainer(
            actor,
            request,
            String(submission.traineeId)
        );
        if (notResponsible) return notResponsible;

        if (!isInOrgScope(scopeOrg(actor), String(submission.organizationId))) {
            return notFound();
        }

        const outOfScope = await ensureContentAllowed(
            actor,
            request,
            'quiz',
            String(submission.quizId)
        );
        if (outOfScope) return outOfScope;

        if (submission.isReviewed === true) {
            return fail(
                'conflict',
                'Diese Quiz-Abgabe wurde bereits bewertet.',
                'Already reviewed'
            );
        }

        // Update quiz submission with score, only of this trainee, organization and state
        const updated = await db
            .update(quizSubmissions)
            .set({
                score,
                reviewedAt: new Date(),
                reviewedById: actor.id,
                isReviewed: true,
            })
            .where(
                and(
                    eq(quizSubmissions.id, submissionId),
                    eq(quizSubmissions.traineeId, submission.traineeId),
                    eq(quizSubmissions.organizationId, submission.organizationId),
                    or(
                        eq(quizSubmissions.isReviewed, false),
                        isNull(quizSubmissions.isReviewed)
                    )
                )
            )
            .returning({ id: quizSubmissions.id });

        if (updated.length === 0) {
            return fail(
                'conflict',
                'Die Quiz-Abgabe hat sich geändert. Bitte versuche es erneut.',
                'Submission changed'
            );
        }

        return {
            success: true,
            message: `📊 **Quiz bewertet!**\n\n✅ Bewertung: ${score}%`,
            data: { submissionId, score },
        };
    } catch (error) {
        console.error('HAI.ai: Error grading quiz:', error);
        return fail(
            'error',
            'Fehler beim Bewerten des Quiz.',
            'Action failed'
        );
    }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Get ISO week number from date
 */
function getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Get the Monday of a given ISO week number and year
 */
function getWeekStartDate(weekNumber: number, year: number): Date {
    const simple = new Date(year, 0, 1 + (weekNumber - 1) * 7);
    const dayOfWeek = simple.getDay();
    const isoWeekStart = simple;
    if (dayOfWeek <= 4) {
        isoWeekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
        isoWeekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }
    return isoWeekStart;
}
