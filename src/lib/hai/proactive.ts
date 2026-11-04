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
    enablers,
    courses,
    enablerSubmissions,
    notifications
} from '@/db/migrations/schemas/schema';
import { getUserOrgIdStrict, toHaiRole } from '@/lib/auth-helpers';
import { getCatalogScopeForUserId } from '@/lib/catalog/scope';
import { loadTraineeProgress } from '@/lib/trainer/trainee-progress';
import {
    firstOpenEnabler,
    loadTraineeCourseFigures,
    type CourseFigure,
} from './progressFigures';

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
            // The courses with the figures of the platform, read once for both checks
            const figures = await loadFiguresOf(userId, traineeCatalogId);
            insights.push(...checkLowProgress(figures));
            insights.push(...suggestNextSteps(figures));
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
 * The courses of the trainee in ONE occupation with the figures of the platform
 * (progressFigures.ts). Fail closed: without an occupation nothing is asked, and
 * a failed lookup is no empty list of courses but no insight (null).
 */
async function loadFiguresOf(
    userId: string,
    catalogId: string | null
): Promise<CourseFigure[] | null> {
    if (!catalogId) return [];
    try {
        return await loadTraineeCourseFigures(userId, [catalogId]);
    } catch (error) {
        console.error('HAI.ai: Error loading the course progress:', error);
        return null;
    }
}

/**
 * Check for low progress in the courses of one occupation: the courses of the
 * other training of a trainee in two trainings are not shown here. The figure is
 * the one of the course card (enablers by the quiz definition, use cases
 * weighted), not the rows of enabler_completions.
 */
function checkLowProgress(figures: CourseFigure[] | null): ProactiveInsight[] {
    const insights: ProactiveInsight[] = [];
    for (const figure of figures ?? []) {
        // Alert if progress is below 30% and there are more than 5 enablers
        if (figure.percent < 30 && figure.enablerTotal > 5) {
            insights.push({
                type: 'warning',
                priority: 'medium',
                title: 'Niedriger Fortschritt',
                message: `Dein Fortschritt in "${figure.title}" ist nur ${figure.percent}%. Zeit, am Ball zu bleiben!`,
                actionable: true,
                actionText: 'Nächsten Enabler starten',
                actionType: 'suggest_next_enabler',
                actionParameters: { courseId: figure.courseId },
            });
        }
    }
    return insights;
}

/**
 * Suggest the next learning step, in the courses of one occupation: the first
 * enabler in the order of the training plan that is not completed and not locked
 * (the same rule as the "next item" of the dashboard).
 */
function suggestNextSteps(figures: CourseFigure[] | null): ProactiveInsight[] {
    const next = firstOpenEnabler(figures ?? []);
    if (!next) return [];
    return [
        {
            type: 'suggestion',
            priority: 'low',
            title: 'Nächster Schritt',
            message: `Bereit für den nächsten Enabler? "${next.enabler.title}" wartet auf dich!`,
            actionable: false,
        },
    ];
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
 * Check trainee progress (trainer-only), per occupation: the progress of a
 * trainee in the courses of ONE occupation, by the figure of the trainer pages
 * (loadTraineeProgress: an enabler counts when its required quizzes are passed).
 * A trainee in two trainings is low in one of them without being low in the
 * other, so the progress of the person as a whole (profiles.overall_progress) is
 * not used. With an occupation only that one is checked; without one every
 * occupation is checked and the name carries the code of the occupation. The
 * rows of enabler_completions are no source (the quiz based completion does not
 * write them: everybody was "low").
 */
async function checkTraineeProgress(
    trainerId: string,
    catalogId?: string | null
): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
        // The active trainees of this trainer, the same list as the overview
        const trainees = await db
            .select({ id: profiles.id, fullName: profiles.fullName })
            .from(profiles)
            .where(
                and(
                    eq(profiles.assignedTrainerId, trainerId),
                    eq(profiles.role, 'TRAINEE'),
                    eq(profiles.isActive, true)
                )
            );
        if (trainees.length === 0) return insights;
        const traineeIds = trainees.map(t => String(t.id));

        // The occupations to check: the chosen one, else every occupation the
        // trainees have a course in
        const catalogs = (catalogId
            ? await db.execute(sql`
                SELECT id, code FROM training_catalogs WHERE id = ${catalogId}
            `)
            : await db.execute(sql`
                SELECT DISTINCT tc.id, tc.code
                FROM course_members cm
                JOIN courses c ON c.id = cm.course_id
                JOIN training_catalogs tc ON tc.id = c.training_catalog_id
                WHERE cm.user_id IN (${sql.join(traineeIds.map(id => sql`${id}`), sql`, `)})
            `)) as unknown as Array<{ id: string; code: string }>;

        const low: Array<{ name: string; code: string; pct: number }> = [];
        for (const catalog of catalogs) {
            const loaded = await loadTraineeProgress(traineeIds, {
                allowedCatalogIds: [String(catalog.id)],
                activeCatalogId: String(catalog.id),
                selected: true,
            });
            for (const trainee of trainees) {
                const figure = loaded.byTrainee.get(String(trainee.id));
                if (!figure || figure.total <= 0 || figure.pct >= 30) continue;
                low.push({
                    name: String(trainee.fullName ?? ''),
                    code: String(catalog.code),
                    pct: figure.pct,
                });
            }
        }
        low.sort((a, b) => a.pct - b.pct);

        if (low.length > 0) {
            // Without a chosen occupation the code tells which training is meant
            const traineeNames = low
                .slice(0, 3)
                .map(t => (catalogId ? t.name : `${t.name} (${t.code})`))
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
