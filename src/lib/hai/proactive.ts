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
 * @returns Array of insights
 */
export async function runProactiveChecks(userId: string): Promise<ProactiveInsight[]> {
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

        const userRole = user[0].role as 'TRAINER' | 'TRAINEE';

        // Run role-specific checks
        if (userRole === 'TRAINEE') {
            insights.push(...await checkMissingActivityReports(userId));
            insights.push(...await checkUpcomingExams(userId));
            insights.push(...await checkLowProgress(userId));
            insights.push(...await suggestNextSteps(userId));
        } else if (userRole === 'TRAINER') {
            insights.push(...await checkPendingReviews(userId));
            insights.push(...await checkTraineeProgress(userId));
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
 * Check for missing activity reports (Tätigkeitsnachweise)
 */
async function checkMissingActivityReports(userId: string): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
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
 * Check for upcoming exams
 */
async function checkUpcomingExams(userId: string): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
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
 * Check for low progress in courses
 */
async function checkLowProgress(userId: string): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Get all courses the user is enrolled in
        const enrollments = await db
            .select({
                courseId: courseMembers.courseId,
                courseTitle: courses.title,
            })
            .from(courseMembers)
            .innerJoin(courses, eq(courseMembers.courseId, courses.id))
            .where(eq(courseMembers.userId, userId));

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
 * Suggest next learning steps
 */
async function suggestNextSteps(userId: string): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Find incomplete enablers in active courses
        const activeEnablers = await db.execute(sql`
            SELECT DISTINCT ON (e.id)
                e.id,
                e.title,
                c.title as course_title
            FROM enablers e
            INNER JOIN courses c ON e.course_id = c.id
            INNER JOIN course_members cm ON c.id = cm.course_id
            LEFT JOIN enabler_completions ec ON e.id = ec.enabler_id AND ec.user_id = ${userId}
            WHERE cm.user_id = ${userId}
                AND e.is_active = true
                AND ec.id IS NULL
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
 * Check for pending reviews (trainer-only)
 */
async function checkPendingReviews(trainerId: string): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Count pending enabler submissions
        const pendingSubmissions = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(enablerSubmissions)
            .where(eq(enablerSubmissions.status, 'PENDING'));

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
            .where(eq(activityReports.status, 'SUBMITTED'));

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
 * Check trainee progress (trainer-only)
 */
async function checkTraineeProgress(trainerId: string): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // Find trainees with low progress assigned to this trainer
        const lowProgressTrainees = await db.execute(sql`
            SELECT
                p.id,
                p.full_name,
                p.overall_progress
            FROM profiles p
            WHERE p.assigned_trainer_id = ${trainerId}
                AND p.role = 'TRAINEE'
                AND p.overall_progress < 30
            ORDER BY p.overall_progress ASC
            LIMIT 3
        `);

        if ((lowProgressTrainees as any[]).length > 0) {
            const traineeNames = (lowProgressTrainees as any[]).map((t: any) => t.full_name).join(', ');

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
        await db.insert(notifications).values({
            userId,
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
