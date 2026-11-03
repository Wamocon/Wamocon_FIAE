/**
 * HAI.ai Proactive Reminder System
 *
 * Analyzes user activity and generates proactive notifications/reminders.
 * This makes HAI a truly helpful assistant, not just a reactive chatbot.
 *
 * Features:
 * - Detect missing activity reports
 * - Remind about upcoming exams
 * - Alert on low progress
 * - Suggest next learning steps
 * - Notify trainers of pending reviews
 *
 * @module lib/hai/proactive
 */

import db from '@/db';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import {
    profiles,
    activityReports,
    ausbildungBlocks,
    enablerCompletions,
    enablers,
    courseMembers,
    courses,
    enablerSubmissions,
    notifications
} from '@/db/migrations/schemas/schema';
import { getUserOrgIdStrict, toHaiRole } from '@/lib/auth-helpers';
import { getCatalogScopeForUserId } from '@/lib/catalog/scope';

// ============================================================================
// TYPES
// ============================================================================

export interface ProactiveInsight {
    type: 'reminder' | 'warning' | 'suggestion' | 'congratulation';
    priority: 'high' | 'medium' | 'low';
    title: string;
    message: string;
    actionable: boolean;
    actionText?: string;
    actionType?: string;
    actionParameters?: Record<string, unknown>;
}

export interface ProactiveCheck {
    userId: string;
    userRole: 'TRAINER' | 'TRAINEE';
    insights: ProactiveInsight[];
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Run all proactive checks for a user
 *
 * @param userId - User ID to check
 * @param catalogId - The occupation the person works in (x-catalog). A trainee
 *   gets reminders of this occupation only (reports, progress, next step),
 *   because a report and a course belong to one occupation. Without it the
 *   default occupation of the trainee counts. A trainer gets the counts of
 *   pending reviews of this occupation, without it those of all occupations of
 *   the organization.
 * @returns Array of insights
 */
export async function runProactiveChecks(
    userId: string,
    catalogId?: string | null
): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Get user details
        const user = await db
            .select({ id: profiles.id, role: profiles.role, fullName: profiles.fullName })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        if (user.length === 0) {
            return insights;
        }

        // Privileged roles (ADMIN, TEMP_ADMIN) are treated as TRAINER.
        const userRole = toHaiRole(user[0].role);

        // Run role-specific checks
        if (userRole === 'TRAINEE') {
            // Fail closed: without an occupation nothing that belongs to one is asked
            const traineeCatalogId =
                catalogId ??
                (await getCatalogScopeForUserId(userId))?.activeCatalogId ??
                null;
            insights.push(...await checkMissingActivityReports(userId, traineeCatalogId));
            insights.push(...await checkUpcomingExams(userId, traineeCatalogId));
            insights.push(...await checkLowProgress(userId, traineeCatalogId));
            insights.push(...await suggestNextSteps(userId, traineeCatalogId));
        } else if (userRole === 'TRAINER') {
            insights.push(...await checkPendingReviews(userId, catalogId));
            insights.push(...await checkTraineeProgress(userId, catalogId));
        }

        // Sort by priority (high first)
        insights.sort((a, b) => {
            const priorityOrder = { high: 0, medium: 1, low: 2 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });

        return insights;
    } catch (error) {
        console.error('HAI.ai: Error in proactive checks:', error);
        return insights;
    }
}

// ============================================================================
// TRAINEE CHECKS
// ============================================================================

/**
 * Check for missing activity reports (Tätigkeitsnachweise) of one occupation:
 * the report of the other training of a trainee in two trainings is not a
 * reason to remind about this one.
 */
async function checkMissingActivityReports(
    userId: string,
    catalogId: string | null
): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Fail closed: without an occupation nothing is asked
        if (!catalogId) return insights;

        // Get current week number
        const now = new Date();
        const currentWeek = getWeekNumber(now);
        const currentYear = now.getFullYear();

        // Check if report for current week exists
        const currentWeekReport = await db
            .select({ id: activityReports.id, status: activityReports.status })
            .from(activityReports)
            .where(
                and(
                    eq(activityReports.traineeId, userId),
                    eq(activityReports.trainingCatalogId, catalogId),
                    eq(activityReports.weekNumber, currentWeek),
                    eq(activityReports.year, currentYear)
                )
            )
            .limit(1);

        if (currentWeekReport.length === 0) {
            insights.push({
                type: 'reminder',
                priority: 'high',
                title: 'Fehlender Tätigkeitsnachweis',
                message: `Dein Tätigkeitsnachweis für KW ${currentWeek} fehlt noch. Möchtest du ihn jetzt erstellen?`,
                actionable: true,
                actionText: 'Nachweis erstellen',
                actionType: 'create_activity_report',
                actionParameters: { weekNumber: currentWeek, year: currentYear },
            });
        } else if (currentWeekReport[0].status === 'DRAFT') {
            insights.push({
                type: 'reminder',
                priority: 'medium',
                title: 'Entwurf einreichen',
                message: `Dein Tätigkeitsnachweis für KW ${currentWeek} ist noch ein Entwurf. Vergiss nicht, ihn einzureichen!`,
                actionable: true,
                actionText: 'Jetzt einreichen',
                actionType: 'submit_activity_report',
                actionParameters: { weekNumber: currentWeek, year: currentYear },
            });
        }

        // Check for previous weeks that are missing or draft
        const previousWeek = currentWeek - 1;
        if (previousWeek >= 1) {
            const previousWeekReport = await db
                .select({ id: activityReports.id, status: activityReports.status })
                .from(activityReports)
                .where(
                    and(
                        eq(activityReports.traineeId, userId),
                        eq(activityReports.trainingCatalogId, catalogId),
                        eq(activityReports.weekNumber, previousWeek),
                        eq(activityReports.year, currentYear)
                    )
                )
                .limit(1);

            if (previousWeekReport.length === 0 || previousWeekReport[0].status === 'DRAFT') {
                insights.push({
                    type: 'warning',
                    priority: 'high',
                    title: 'Vorwoche nicht eingereicht',
                    message: `Der Tätigkeitsnachweis für KW ${previousWeek} wurde noch nicht eingereicht. Bitte nachreichen!`,
                    actionable: previousWeekReport.length > 0,
                    actionText: previousWeekReport.length > 0 ? 'Nachreichen' : 'Erstellen',
                    actionType: previousWeekReport.length > 0 ? 'submit_activity_report' : 'create_activity_report',
                    actionParameters: { weekNumber: previousWeek, year: currentYear },
                });
            }
        }
    } catch (error) {
        console.error('HAI.ai: Error checking activity reports:', error);
    }

    return insights;
}

/**
 * Check for upcoming exams of one occupation: an exam of the other training of
 * a trainee in two trainings is not a reason to remind about this one.
 */
async function checkUpcomingExams(
    userId: string,
    catalogId: string | null
): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Fail closed: without an occupation nothing is asked
        if (!catalogId) return insights;

        // Find exams in the next 14 days
        const now = new Date();
        const twoWeeksLater = new Date(now);
        twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);

        const upcomingExams = await db
            .select({
                blockType: ausbildungBlocks.blockType,
                startDate: ausbildungBlocks.startDate,
                endDate: ausbildungBlocks.endDate,
            })
            .from(ausbildungBlocks)
            .where(
                and(
                    // Only the exams of this trainee, never those of others
                    eq(ausbildungBlocks.traineeId, userId),
                    eq(ausbildungBlocks.trainingCatalogId, catalogId),
                    eq(ausbildungBlocks.blockType, 'EXAM'),
                    gte(ausbildungBlocks.startDate, now),
                    lte(ausbildungBlocks.startDate, twoWeeksLater)
                )
            )
            .orderBy(ausbildungBlocks.startDate)
            .limit(3);

        for (const exam of upcomingExams) {
            const daysUntil = Math.ceil((exam.startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

            insights.push({
                type: 'reminder',
                priority: daysUntil <= 7 ? 'high' : 'medium',
                title: 'Anstehende Prüfung',
                message: `Prüfung in ${daysUntil} Tagen (${exam.startDate.toLocaleDateString('de-DE')}). Bist du vorbereitet?`,
                actionable: true,
                actionText: 'Prüfungsvorbereitung starten',
                actionType: 'exam_prep',
            });
        }
    } catch (error) {
        console.error('HAI.ai: Error checking upcoming exams:', error);
    }

    return insights;
}

/**
 * Check for low progress in the courses of one occupation: the courses of the
 * other training of a trainee in two trainings are not shown here.
 */
async function checkLowProgress(
    userId: string,
    catalogId: string | null
): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Fail closed: without an occupation nothing is asked
        if (!catalogId) return insights;

        // Get the courses of this occupation the user is enrolled in
        const enrollments = await db
            .select({
                courseId: courseMembers.courseId,
                courseTitle: courses.title,
            })
            .from(courseMembers)
            .innerJoin(courses, eq(courseMembers.courseId, courses.id))
            .where(
                and(
                    eq(courseMembers.userId, userId),
                    eq(courses.trainingCatalogId, catalogId)
                )
            );

        for (const enrollment of enrollments) {
            // Count total enablers in course
            const totalEnablers = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(enablers)
                .where(
                    and(
                        eq(enablers.courseId, enrollment.courseId),
                        eq(enablers.isActive, true)
                    )
                );

            const total = totalEnablers[0]?.count || 0;

            // Count completed enablers
            const completedEnablers = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(enablerCompletions)
                .innerJoin(enablers, eq(enablerCompletions.enablerId, enablers.id))
                .where(
                    and(
                        eq(enablerCompletions.traineeId, userId),
                        eq(enablers.courseId, enrollment.courseId)
                    )
                );

            const completed = completedEnablers[0]?.count || 0;
            const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

            // Alert if progress is below 30% and there are more than 5 enablers
            if (progressPercent < 30 && total > 5) {
                insights.push({
                    type: 'warning',
                    priority: 'medium',
                    title: 'Niedriger Fortschritt',
                    message: `Dein Fortschritt in "${enrollment.courseTitle}" ist nur ${progressPercent}%. Zeit, am Ball zu bleiben!`,
                    actionable: true,
                    actionText: 'Nächsten Enabler starten',
                    actionType: 'suggest_next_enabler',
                    actionParameters: { courseId: enrollment.courseId },
                });
            }
        }
    } catch (error) {
        console.error('HAI.ai: Error checking low progress:', error);
    }

    return insights;
}

/**
 * Suggest next learning steps, in the courses of one occupation
 */
async function suggestNextSteps(
    userId: string,
    catalogId: string | null
): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Fail closed: without an occupation nothing is suggested
        if (!catalogId) return insights;

        // Find incomplete enablers in active courses of this occupation
        const activeEnablers = await db.execute(sql`
            SELECT DISTINCT ON (e.id)
                e.id,
                e.title,
                c.title as course_title
            FROM enablers e
            INNER JOIN courses c ON e.course_id = c.id
            INNER JOIN course_members cm ON c.id = cm.course_id
            LEFT JOIN enabler_completions ec ON e.id = ec.enabler_id AND ec.trainee_id = ${userId}
            WHERE cm.user_id = ${userId}
                AND c.training_catalog_id = ${catalogId}
                AND e.is_active = true
                AND ec.enabler_id IS NULL
            ORDER BY e.id, e.created_at
            LIMIT 1
        `);

        if ((activeEnablers as any[]).length > 0) {
            const enabler = (activeEnablers as any[])[0];
            insights.push({
                type: 'suggestion',
                priority: 'low',
                title: 'Nächster Schritt',
                message: `Bereit für den nächsten Enabler? "${enabler.title}" wartet auf dich!`,
                actionable: false,
            });
        }
    } catch (error) {
        console.error('HAI.ai: Error suggesting next steps:', error);
    }

    return insights;
}

// ============================================================================
// TRAINER CHECKS
// ============================================================================

/**
 * Check for pending reviews (trainer-only). With an occupation only the
 * submissions and reports of this occupation are counted, without one those of
 * all occupations of the organization.
 */
async function checkPendingReviews(
    trainerId: string,
    catalogId?: string | null
): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Only the organization of the trainer, never the counts of others
        const organizationId = await getUserOrgIdStrict(trainerId);

        // Count pending enabler submissions
        const pendingSubmissions = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(enablerSubmissions)
            .innerJoin(enablers, eq(enablerSubmissions.enablerId, enablers.id))
            .where(
                and(
                    eq(enablerSubmissions.status, 'PENDING'),
                    eq(enablerSubmissions.organizationId, organizationId),
                    catalogId ? eq(enablers.trainingCatalogId, catalogId) : undefined
                )
            );

        const submissionCount = pendingSubmissions[0]?.count || 0;

        if (submissionCount > 0) {
            insights.push({
                type: 'reminder',
                priority: 'high',
                title: 'Ausstehende Bewertungen',
                message: `${submissionCount} Einreichung${submissionCount > 1 ? 'en' : ''} warte${submissionCount > 1 ? 'n' : 't'} auf deine Bewertung.`,
                actionable: true,
                actionText: 'Bewertungen ansehen',
                actionType: 'view_pending_submissions',
            });
        }

        // Count pending activity reports
        const pendingReports = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(activityReports)
            .where(
                and(
                    eq(activityReports.status, 'SUBMITTED'),
                    eq(activityReports.organizationId, organizationId),
                    catalogId
                        ? eq(activityReports.trainingCatalogId, catalogId)
                        : undefined
                )
            );

        const reportCount = pendingReports[0]?.count || 0;

        if (reportCount > 0) {
            insights.push({
                type: 'reminder',
                priority: 'high',
                title: 'Ausstehende Nachweise',
                message: `${reportCount} Tätigkeitsnachweis${reportCount > 1 ? 'e' : ''} warte${reportCount > 1 ? 'n' : 't'} auf Genehmigung.`,
                actionable: true,
                actionText: 'Nachweise prüfen',
                actionType: 'view_pending_reports',
            });
        }
    } catch (error) {
        console.error('HAI.ai: Error checking pending reviews:', error);
    }

    return insights;
}

/**
 * Check trainee progress (trainer-only), per occupation: the share of the active
 * enablers of the courses of ONE occupation that a trainee has completed. A
 * trainee in two trainings is low in one of them without being low in the
 * other, so the progress of the person as a whole (profiles.overall_progress) is
 * not used. With an occupation only that one is checked; without one every
 * occupation is checked and the name carries the code of the occupation.
 */
async function checkTraineeProgress(
    trainerId: string,
    catalogId?: string | null
): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Find trainees assigned to this trainer with low progress in an occupation
        const lowProgressTrainees = await db.execute(sql`
            SELECT
                p.id,
                p.full_name,
                tc.code AS catalog_code,
                ROUND(100.0 * COUNT(DISTINCT ec.enabler_id) / COUNT(DISTINCT e.id)) AS progress
            FROM profiles p
            INNER JOIN course_members cm ON cm.user_id = p.id
            INNER JOIN courses c ON c.id = cm.course_id
            INNER JOIN training_catalogs tc ON tc.id = c.training_catalog_id
            INNER JOIN enablers e ON e.course_id = c.id AND e.is_active = true
            LEFT JOIN enabler_completions ec ON ec.enabler_id = e.id AND ec.trainee_id = p.id
            WHERE p.assigned_trainer_id = ${trainerId}
                AND p.role = 'TRAINEE'
                ${catalogId ? sql`AND c.training_catalog_id = ${catalogId}` : sql``}
            GROUP BY p.id, p.full_name, tc.code
            HAVING ROUND(100.0 * COUNT(DISTINCT ec.enabler_id) / COUNT(DISTINCT e.id)) < 30
            ORDER BY progress ASC
            LIMIT 3
        `);

        if ((lowProgressTrainees as any[]).length > 0) {
            // Without a chosen occupation the code tells which training is meant
            const traineeNames = (lowProgressTrainees as any[])
                .map((t: any) =>
                    catalogId ? t.full_name : `${t.full_name} (${t.catalog_code})`
                )
                .join(', ');

            insights.push({
                type: 'warning',
                priority: 'medium',
                title: 'Azubis brauchen Unterstützung',
                message: `Folgende Azubis haben niedrigen Fortschritt: ${traineeNames}. Vielleicht mal nachfragen?`,
                actionable: false,
            });
        }
    } catch (error) {
        console.error('HAI.ai: Error checking trainee progress:', error);
    }

    return insights;
}

// ============================================================================
// NOTIFICATION CREATION
// ============================================================================

/**
 * Create a notification from an insight
 *
 * @param userId - User to notify
 * @param insight - The insight to convert to notification
 */
export async function createNotificationFromInsight(
    userId: string,
    insight: ProactiveInsight
): Promise<void> {
    try {
        // A write never falls back to the platform organization
        const organizationId = await getUserOrgIdStrict(userId);
        await db.insert(notifications).values({
            userId,
            organizationId,
            type: insight.type === 'warning' ? 'REPORT_UPDATE' : 'GENERAL',
            title: insight.title,
            message: insight.message,
            isRead: false,
        });
    } catch (error) {
        console.error('HAI.ai: Error creating notification:', error);
    }
}

/**
 * Send all high-priority insights as notifications
 *
 * @param userId - User ID
 */
export async function sendProactiveNotifications(userId: string): Promise<number> {
    try {
        const insights = await runProactiveChecks(userId);
        const highPriority = insights.filter(i => i.priority === 'high');

        for (const insight of highPriority) {
            await createNotificationFromInsight(userId, insight);
        }

        return highPriority.length;
    } catch (error) {
        console.error('HAI.ai: Error sending proactive notifications:', error);
        return 0;
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
