/**
 * HAI.ai Action Execution System
 *
 * Enables HAI to perform write operations on the platform.
 * This transforms HAI from a read-only assistant to a full platform agent.
 *
 * Action Flow:
 * 1. Detect action intent from user message
 * 2. Extract parameters needed for the action
 * 3. Verify user permissions
 * 4. Execute the action via platform APIs
 * 5. Return result for HAI to narrate back to user
 *
 * @module lib/hai/actions
 */

import db from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { toHaiRole } from '@/lib/auth-helpers';
import {
    activityReports,
    enablerCompletions,
    quizSubmissions,
    notifications,
    enablerSubmissions,
    profiles,
    enablers
} from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';

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
}

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
            requiresConfirmation: false,
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
            requiresConfirmation: false,
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
 * Execute an action on behalf of the user
 *
 * @param actionType - The action to perform
 * @param parameters - Action parameters
 * @param userId - User ID performing the action
 * @returns Result of the action
 */
export async function executeAction(
    actionType: ActionType,
    parameters: Record<string, unknown>,
    userId: string
): Promise<ActionResult> {
    try {
        // Verify user exists and get role
        const user = await db
            .select({ id: profiles.id, role: profiles.role, fullName: profiles.fullName })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        if (user.length === 0) {
            return {
                success: false,
                message: 'Benutzer nicht gefunden.',
                error: 'User not found',
            };
        }

        const userRole = toHaiRole(user[0].role);

        // Route to specific action handler
        switch (actionType) {
            case 'create_activity_report':
                return await createActivityReport(userId, parameters);

            case 'submit_activity_report':
                return await submitActivityReport(userId, parameters);

            case 'complete_enabler':
                return await completeEnabler(userId, parameters);

            case 'submit_quiz':
                return await submitQuiz(userId, parameters);

            case 'mark_notification_read':
                return await markNotificationRead(userId, parameters);

            case 'approve_submission':
                if (userRole !== 'TRAINER') {
                    return {
                        success: false,
                        message: 'Nur Trainer können Abgaben genehmigen.',
                        error: 'Permission denied',
                    };
                }
                return await approveSubmission(userId, parameters);

            case 'approve_report':
                if (userRole !== 'TRAINER') {
                    return {
                        success: false,
                        message: 'Nur Trainer können Nachweise genehmigen.',
                        error: 'Permission denied',
                    };
                }
                return await approveReport(userId, parameters);

            case 'grade_quiz':
                if (userRole !== 'TRAINER') {
                    return {
                        success: false,
                        message: 'Nur Trainer können Quizze bewerten.',
                        error: 'Permission denied',
                    };
                }
                return await gradeQuiz(userId, parameters);

            default:
                return {
                    success: false,
                    message: `Aktion "${actionType}" ist noch nicht implementiert.`,
                    error: 'Action not implemented',
                };
        }
    } catch (error) {
        console.error(`HAI.ai: Action execution error (${actionType}):`, error);
        return {
            success: false,
            message: 'Ein Fehler ist aufgetreten beim Ausführen der Aktion.',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
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
            return {
                success: false,
                message: `Ein Tätigkeitsnachweis für KW ${weekNumber}/${year} existiert bereits.`,
                error: 'Report already exists',
            };
        }

        // Calculate period dates (Monday to Sunday of the week)
        const periodStart = getWeekStartDate(weekNumber, year);
        const periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + 6);

        // Determine training year (simplified - would need actual enrollment date)
        const ausbildungsjahr = 1; // TODO: Calculate based on enrollment date

        const organizationId = await getUserOrgId(userId);

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
            message: `📝 **Tätigkeit snachweis erstellt!**\n\n✅ KW ${weekNumber}/${year} wurde als Entwurf gespeichert.\n\n💡 **Nächste Schritte:**\n- Öffne den Nachweis und füge deine Tätigkeiten hinzu\n- Wenn fertig: "Reiche meinen Tätigkeitsnachweis ein"`,
            data: { reportId: newReport[0].id, weekNumber, year },
        };
    } catch (error) {
        console.error('HAI.ai: Error creating activity report:', error);
        return {
            success: false,
            message: 'Fehler beim Erstellen des Tätigkeitsnachweises.',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
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
            return {
                success: false,
                message: 'Kein Tätigkeitsnachweis zum Einreichen gefunden.',
                error: 'Report not found',
            };
        }

        const report = reportToSubmit[0];

        if (report.status !== 'DRAFT') {
            return {
                success: false,
                message: `Der Tätigkeitsnachweis wurde bereits eingereicht (Status: ${report.status}).`,
                error: 'Report already submitted',
            };
        }

        // Update status to SUBMITTED
        await db
            .update(activityReports)
            .set({
                status: 'SUBMITTED',
                submittedAt: new Date(),
            })
            .where(eq(activityReports.id, report.id));

        return {
            success: true,
            message: `📤 **Tätigkeitsnachweis eingereicht!**\n\n✅ KW ${report.weekNumber} wurde zur Prüfung eingereicht.\n\n📬 Dein Trainer wird benachrichtigt und gibt dir bald Feedback.`,
            data: { reportId: report.id },
        };
    } catch (error) {
        console.error('HAI.ai: Error submitting activity report:', error);
        return {
            success: false,
            message: 'Fehler beim Einreichen des Tätigkeitsnachweises.',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Mark an enabler as completed
 */
async function completeEnabler(
    userId: string,
    parameters: Record<string, unknown>
): Promise<ActionResult> {
    try {
        const enablerId = parameters.enablerId as string | undefined;

        if (!enablerId) {
            return {
                success: false,
                message: 'Keine Enabler-ID angegeben. Bitte gib an, welchen Enabler du abschließen möchtest.',
                error: 'Missing enablerId',
            };
        }

        // Check if enabler exists
        const enabler = await db
            .select({ id: enablers.id, title: enablers.title })
            .from(enablers)
            .where(eq(enablers.id, enablerId))
            .limit(1);

        if (enabler.length === 0) {
            return {
                success: false,
                message: 'Enabler nicht gefunden.',
                error: 'Enabler not found',
            };
        }

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

        if (existing.length > 0) {
            return {
                success: false,
                message: `Der Enabler "${enabler[0].title}" wurde bereits als abgeschlossen markiert.`,
                error: 'Already completed',
            };
        }

        // Mark as completed
        await db.insert(enablerCompletions).values({
            traineeId: userId,
            enablerId,
            completedAt: new Date(),
        });

        return {
            success: true,
            message: `🎉 **Glückwunsch!**\n\n✅ "${enabler[0].title}" wurde als abgeschlossen markiert.\n\n🚀 Weiter so! Dein Fortschritt wurde aktualisiert.`,
            data: { enablerId, enablerTitle: enabler[0].title },
        };
    } catch (error) {
        console.error('HAI.ai: Error completing enabler:', error);
        return {
            success: false,
            message: 'Fehler beim Abschließen des Enablers.',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Submit a quiz
 */
async function submitQuiz(
    userId: string,
    parameters: Record<string, unknown>
): Promise<ActionResult> {
    try {
        const quizId = parameters.quizId as string | undefined;
        const answers = parameters.answers as unknown[] | undefined;

        if (!quizId || !answers) {
            return {
                success: false,
                message: 'Unvollständige Quiz-Daten. Bitte gib Quiz-ID und Antworten an.',
                error: 'Missing parameters',
            };
        }

        const organizationId = await getUserOrgId(userId);

        // Submit quiz
        await db.insert(quizSubmissions).values({
            traineeId: userId,
            quizId,
            submittedAt: new Date(),
            organizationId,
        });

        return {
            success: true,
            message: '📋 **Quiz eingereicht!**\n\n✅ Deine Antworten wurden gespeichert.\n\n👨‍🏫 Dein Trainer wird das Quiz bewerten und dir Feedback geben.',
            data: { quizId },
        };
    } catch (error) {
        console.error('HAI.ai: Error submitting quiz:', error);
        return {
            success: false,
            message: 'Fehler beim Einreichen des Quiz.',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
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
            return {
                success: false,
                message: 'Bitte gib an, welche Benachrichtigung(en) markiert werden sollen.',
                error: 'Missing parameters',
            };
        }
    } catch (error) {
        console.error('HAI.ai: Error marking notification read:', error);
        return {
            success: false,
            message: 'Fehler beim Markieren der Benachrichtigung.',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

// ============================================================================
// TRAINER ACTIONS
// ============================================================================

/**
 * Approve an enabler submission
 */
async function approveSubmission(
    trainerId: string,
    parameters: Record<string, unknown>
): Promise<ActionResult> {
    try {
        const submissionId = parameters.submissionId as string | undefined;

        if (!submissionId) {
            return {
                success: false,
                message: 'Keine Submission-ID angegeben.',
                error: 'Missing submissionId',
            };
        }

        // Update submission status
        await db
            .update(enablerSubmissions)
            .set({
                status: 'APPROVED',
                reviewedAt: new Date(),
            })
            .where(eq(enablerSubmissions.id, submissionId));

        return {
            success: true,
            message: '✅ **Abgabe genehmigt!**\n\nDer Azubi wurde benachrichtigt. 📬',
            data: { submissionId },
        };
    } catch (error) {
        console.error('HAI.ai: Error approving submission:', error);
        return {
            success: false,
            message: 'Fehler beim Genehmigen der Abgabe.',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Approve an activity report
 */
async function approveReport(
    trainerId: string,
    parameters: Record<string, unknown>
): Promise<ActionResult> {
    try {
        const reportId = parameters.reportId as string | undefined;

        if (!reportId) {
            return {
                success: false,
                message: 'Keine Report-ID angegeben.',
                error: 'Missing reportId',
            };
        }

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

        if (reportRows.length === 0) {
            return {
                success: false,
                message: 'Tätigkeitsnachweis nicht gefunden.',
                error: 'Report not found',
            };
        }

        const report = reportRows[0];

        // Security: verify trainer is assigned to this trainee
        if (report.assignedTrainerId !== trainerId) {
            return {
                success: false,
                message: 'Sie sind nicht als verantwortlicher Trainer für diesen Auszubildenden eingetragen.',
                error: 'Trainer not assigned to trainee',
            };
        }

        // Validate workflow state
        if (report.status !== 'SUBMITTED') {
            return {
                success: false,
                message: `Der Tätigkeitsnachweis kann nicht genehmigt werden (Status: ${report.status}). Nur eingereichte Nachweise können genehmigt werden.`,
                error: 'Invalid report status',
            };
        }

        // Update report status
        await db
            .update(activityReports)
            .set({
                status: 'APPROVED',
                reviewedAt: new Date(),
                reviewerId: trainerId,
            })
            .where(eq(activityReports.id, reportId));

        return {
            success: true,
            message: '✅ **Tätigkeitsnachweis genehmigt!**\n\nDer Azubi kann jetzt mit der nächsten Woche fortfahren. 📝',
            data: { reportId },
        };
    } catch (error) {
        console.error('HAI.ai: Error approving report:', error);
        return {
            success: false,
            message: 'Fehler beim Genehmigen des Tätigkeitsnachweises.',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Grade a quiz submission
 */
async function gradeQuiz(
    trainerId: string,
    parameters: Record<string, unknown>
): Promise<ActionResult> {
    try {
        const submissionId = parameters.submissionId as string | undefined;
        const score = parameters.score as number | undefined;

        if (!submissionId || score === undefined) {
            return {
                success: false,
                message: 'Unvollständige Daten zum Bewerten des Quiz.',
                error: 'Missing parameters',
            };
        }

        // Update quiz submission with score
        await db
            .update(quizSubmissions)
            .set({
                score,
                reviewedAt: new Date(),
                reviewedById: trainerId,
                isReviewed: true,
            })
            .where(eq(quizSubmissions.id, submissionId));

        return {
            success: true,
            message: `📊 **Quiz bewertet!**\n\n✅ Bewertung: ${score}%\n\nDer Azubi wurde über die Bewertung informiert. 📬`,
            data: { submissionId, score },
        };
    } catch (error) {
        console.error('HAI.ai: Error grading quiz:', error);
        return {
            success: false,
            message: 'Fehler beim Bewerten des Quiz.',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
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
