/**
 * HAI.ai Data Context Layer
 *
 * Injects live platform data into the system prompt at chat time.
 * Enables HAI to answer questions about trainee progress, calendar,
 * Taetigkeitsnachweis, notifications, and trainer-specific queries.
 *
 * ARCHITECTURE:
 *   1. classifyDataIntent() detects data-related keywords in the user message
 *   2. fetchDataContext() queries the DB for live data matching the intent
 *   3. German formatters produce compact text blocks (~150-400 tokens each)
 *   4. The result is injected into buildSystemPrompt() as liveDataContext
 *
 * KEY PRINCIPLE: Data fetch is non-fatal. If any query fails, HAI falls back
 * to RAG-only with zero impact on the response.
 *
 * @module lib/hai/dataContext
 */

import db from '@/db';
import { sql, eq, and, desc, gte, lte, count, inArray } from 'drizzle-orm';
import {
    profiles,
    courses,
    courseMembers,
    enablers,
    enablerCompletions,
    enablerSubmissions,
    quizSubmissions,
    useCaseSubmissions,
    ausbildungBlocks,
    schoolExams,
    schoolExamResults,
    activityReports,
    notifications,
} from '@/db/migrations/schemas/schema';

// ============================================================================
// TYPES
// ============================================================================

export type UserRole = 'TRAINER' | 'TRAINEE';

export type DataIntent =
    | 'progress_query'      // "Wie ist mein Fortschritt?"
    | 'calendar_query'      // "Wann habe ich Berufsschule?"
    | 'exam_query'          // "Wann ist meine naechste Pruefung?"
    | 'report_query'        // "Wie ist der Stand meiner Nachweise?"
    | 'notification_query'  // "Habe ich neue Benachrichtigungen?"
    | 'review_query'        // Trainer: "Was muss ich bewerten?"
    | 'trainee_overview'    // Trainer: "Wie stehen meine Azubis?"
    | 'none';               // No data intent detected

export interface LiveDataContext {
    /** Formatted German text ready for system prompt injection */
    summary: string;
    /** Estimated token count for budget tracking */
    tokenEstimate: number;
    /** Which data intent was detected */
    dataIntent: DataIntent;
}

export interface UserSnapshot {
    fullName: string;
    role: UserRole;
    overallProgressPercent: number;
    unreadNotifications: number;
    currentBlockType: string | null;
}

export interface CourseProgress {
    courseTitle: string;
    totalEnablers: number;
    completedEnablers: number;
    progressPercent: number;
    latestQuizScore: number | null;
    nextEnablerTitle: string | null;
}

export interface CalendarInfo {
    currentBlockType: string | null;
    currentBlockTitle: string | null;
    upcomingExams: Array<{
        subject: string;
        examDate: Date;
        examType: string | null;
    }>;
    nextSchoolBlock: {
        calendarWeek: number;
        startDate: Date;
    } | null;
}

export interface ReportStatus {
    draft: number;
    submitted: number;
    approved: number;
    rejected: number;
    currentWeekExists: boolean;
}

export interface NotificationInfo {
    unreadCount: number;
    recentTitles: string[];
}

export interface TrainerPendingReviews {
    pendingEnablerSubmissions: number;
    pendingUseCaseSubmissions: number;
    pendingQuizReviews: number;
    pendingReportReviews: number;
}

export interface TrainerTraineeInfo {
    fullName: string;
    progressPercent: number;
}

// ============================================================================
// DATA INTENT CLASSIFIER
// ============================================================================

/**
 * Classify the data intent from a user message.
 * Uses German keyword matching to detect when the user asks about live data.
 *
 * @param message - The user's chat message
 * @param userRole - The user's role (TRAINER or TRAINEE)
 * @returns The detected DataIntent
 */
export function classifyDataIntent(message: string, userRole: UserRole): DataIntent {
    const lower = message.toLowerCase();

    // Trainer-only intents first (more specific)
    if (userRole === 'TRAINER') {
        const reviewKeywords = [
            'bewerten', 'ausstehend', 'korrigieren', 'review', 'abgaben',
            'eingereicht', 'submissions', 'pruefe', 'zu bewerten',
            'offene abgaben', 'pending', 'was muss ich',
        ];
        if (reviewKeywords.some(k => lower.includes(k))) {
            return 'review_query';
        }

        const overviewKeywords = [
            'azubi', 'ueberblick', 'meine azubis', 'trainee',
            'wie stehen', 'fortschritt meiner', 'alle azubis',
            'azubi-uebersicht', 'meine auszubildenden',
        ];
        if (overviewKeywords.some(k => lower.includes(k))) {
            return 'trainee_overview';
        }
    }

    // Progress keywords
    const progressKeywords = [
        'fortschritt', 'wie weit', 'status', 'abgeschlossen',
        'erledigt', 'progress', 'geschafft', 'wie viel',
        'noch offen', 'wie stehe ich', 'mein stand',
    ];
    if (progressKeywords.some(k => lower.includes(k))) {
        return 'progress_query';
    }

    // Calendar keywords
    const calendarKeywords = [
        'kalender', 'woche', 'berufsschule', 'schulblock',
        'betrieb', 'urlaub', 'ferien', 'wann habe ich',
        'naechste woche', 'diese woche', 'block', 'zeitplan',
    ];
    if (calendarKeywords.some(k => lower.includes(k))) {
        return 'calendar_query';
    }

    // Exam keywords
    const examKeywords = [
        'pruefung', 'klausur', 'ihk', 'abschlusspruefung',
        'test', 'examen', 'naechste pruefung', 'wann schreibe ich',
        'ap1', 'ap2', 'teil 1', 'teil 2',
    ];
    if (examKeywords.some(k => lower.includes(k))) {
        return 'exam_query';
    }

    // Report keywords
    const reportKeywords = [
        'nachweis', 'taetigkeitsnachweis', 'bericht', 'berichtsheft',
        'wochenbericht', 'activity report', 'nachweise',
        'ausbildungsnachweis', 'wie viele berichte',
    ];
    if (reportKeywords.some(k => lower.includes(k))) {
        return 'report_query';
    }

    // Notification keywords
    const notificationKeywords = [
        'benachrichtigung', 'neuigkeiten', 'notification',
        'neue nachrichten', 'was gibt es neues', 'updates',
        'ungelesen', 'inbox',
    ];
    if (notificationKeywords.some(k => lower.includes(k))) {
        return 'notification_query';
    }

    return 'none';
}

// ============================================================================
// ALWAYS-ON: USER SNAPSHOT
// ============================================================================

/**
 * Fetch a compact snapshot of the user (~100-150 tokens).
 * Always included in the system prompt to give HAI basic awareness.
 */
export async function fetchUserSnapshot(userId: string): Promise<UserSnapshot | null> {
    try {
        // Get user profile
        const user = await db
            .select({
                fullName: profiles.fullName,
                firstName: profiles.firstName,
                role: profiles.role,
            })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        if (user.length === 0) return null;

        const displayName = user[0].fullName || user[0].firstName || 'Nutzer';
        const role = user[0].role as UserRole;

        // Get overall progress (completed enablers / total active enablers across enrolled courses)
        const progressResult = await db.execute(sql`
            SELECT
                COUNT(DISTINCT ec.enabler_id) AS completed,
                COUNT(DISTINCT e.id) AS total
            FROM course_members cm
            JOIN enablers e ON e.course_id = cm.course_id AND e.is_active = true
            LEFT JOIN enabler_completions ec ON ec.enabler_id = e.id AND ec.trainee_id = ${userId}
            WHERE cm.user_id = ${userId}
        `);

        const row = (progressResult as any[])[0] || { completed: 0, total: 0 };
        const completed = Number(row.completed) || 0;
        const total = Number(row.total) || 0;
        const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

        // Get unread notification count
        const unreadResult = await db
            .select({ cnt: count() })
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.isRead, false),
            ));
        const unreadCount = Number(unreadResult[0]?.cnt) || 0;

        // Get current block type (this week)
        const now = new Date();
        const currentWeekBlocks = await db
            .select({ blockType: ausbildungBlocks.blockType })
            .from(ausbildungBlocks)
            .where(and(
                eq(ausbildungBlocks.traineeId, userId),
                lte(ausbildungBlocks.startDate, now),
                gte(ausbildungBlocks.endDate, now),
            ))
            .limit(1);

        const currentBlock = currentWeekBlocks.length > 0 ? currentWeekBlocks[0].blockType : null;

        return {
            fullName: displayName,
            role,
            overallProgressPercent: progressPercent,
            unreadNotifications: unreadCount,
            currentBlockType: currentBlock,
        };
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching user snapshot:', error);
        return null;
    }
}

// ============================================================================
// TRAINEE FETCHERS
// ============================================================================

/**
 * Fetch per-course progress for the trainee.
 */
export async function fetchTraineeProgress(userId: string): Promise<CourseProgress[]> {
    try {
        // Get all courses the trainee is enrolled in
        const enrolledCourses = await db
            .select({
                courseId: courseMembers.courseId,
                courseTitle: courses.title,
            })
            .from(courseMembers)
            .innerJoin(courses, eq(courses.id, courseMembers.courseId))
            .where(and(
                eq(courseMembers.userId, userId),
                eq(courses.isActive, true),
            ));

        if (enrolledCourses.length === 0) return [];

        const results: CourseProgress[] = [];

        for (const course of enrolledCourses) {
            // Get all active enablers in this course
            const courseEnablers = await db
                .select({
                    id: enablers.id,
                    title: enablers.title,
                    orderIndex: enablers.orderIndex,
                })
                .from(enablers)
                .where(and(
                    eq(enablers.courseId, course.courseId),
                    eq(enablers.isActive, true),
                ))
                .orderBy(enablers.orderIndex);

            if (courseEnablers.length === 0) continue;

            const enablerIds = courseEnablers.map(e => e.id);

            // Count completed enablers
            const completedResult = await db
                .select({ cnt: count() })
                .from(enablerCompletions)
                .where(and(
                    eq(enablerCompletions.traineeId, userId),
                    inArray(enablerCompletions.enablerId, enablerIds),
                ));
            const completedCount = Number(completedResult[0]?.cnt) || 0;

            // Get latest quiz score for this course
            const latestQuiz = await db.execute(sql`
                SELECT qs.score
                FROM quiz_submissions qs
                JOIN enabler_quiz_links eql ON eql.quiz_id = qs.quiz_id
                JOIN enablers e ON e.id = eql.enabler_id AND e.course_id = ${course.courseId}
                WHERE qs.trainee_id = ${userId}
                ORDER BY qs.submitted_at DESC
                LIMIT 1
            `);

            const latestScore = (latestQuiz as any[]).length > 0
                ? Number((latestQuiz as any[])[0].score)
                : null;

            // Find next incomplete enabler
            const completedIds = await db
                .select({ enablerId: enablerCompletions.enablerId })
                .from(enablerCompletions)
                .where(and(
                    eq(enablerCompletions.traineeId, userId),
                    inArray(enablerCompletions.enablerId, enablerIds),
                ));
            const completedSet = new Set(completedIds.map(c => c.enablerId));
            const nextEnabler = courseEnablers.find(e => !completedSet.has(e.id));

            results.push({
                courseTitle: course.courseTitle,
                totalEnablers: courseEnablers.length,
                completedEnablers: completedCount,
                progressPercent: Math.round((completedCount / courseEnablers.length) * 100),
                latestQuizScore: latestScore,
                nextEnablerTitle: nextEnabler?.title || null,
            });
        }

        return results;
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching trainee progress:', error);
        return [];
    }
}

/**
 * Fetch calendar info: current block, upcoming exams, next school block.
 */
export async function fetchCalendar(userId: string): Promise<CalendarInfo> {
    const defaultResult: CalendarInfo = {
        currentBlockType: null,
        currentBlockTitle: null,
        upcomingExams: [],
        nextSchoolBlock: null,
    };

    try {
        const now = new Date();
        const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

        // Current block
        const currentBlocks = await db
            .select({
                blockType: ausbildungBlocks.blockType,
                title: ausbildungBlocks.title,
                notes: ausbildungBlocks.notes,
            })
            .from(ausbildungBlocks)
            .where(and(
                eq(ausbildungBlocks.traineeId, userId),
                lte(ausbildungBlocks.startDate, now),
                gte(ausbildungBlocks.endDate, now),
            ))
            .limit(1);

        if (currentBlocks.length > 0) {
            defaultResult.currentBlockType = currentBlocks[0].blockType;
            defaultResult.currentBlockTitle = currentBlocks[0].title || currentBlocks[0].notes || null;
        }

        // Upcoming exams (next 14 days)
        const upcomingExams = await db
            .select({
                subject: schoolExams.subject,
                examDate: schoolExams.examDate,
                examType: schoolExams.examTypeValue,
            })
            .from(schoolExams)
            .where(and(
                eq(schoolExams.traineeId, userId),
                gte(schoolExams.examDate, now),
                lte(schoolExams.examDate, twoWeeksLater),
            ))
            .orderBy(schoolExams.examDate)
            .limit(5);

        defaultResult.upcomingExams = upcomingExams.map(e => ({
            subject: e.subject,
            examDate: new Date(e.examDate),
            examType: e.examType,
        }));

        // Next school block
        const nextSchool = await db
            .select({
                calendarWeek: ausbildungBlocks.calendarWeek,
                startDate: ausbildungBlocks.startDate,
            })
            .from(ausbildungBlocks)
            .where(and(
                eq(ausbildungBlocks.traineeId, userId),
                eq(ausbildungBlocks.blockType, 'SCHOOL'),
                gte(ausbildungBlocks.startDate, now),
            ))
            .orderBy(ausbildungBlocks.startDate)
            .limit(1);

        if (nextSchool.length > 0) {
            defaultResult.nextSchoolBlock = {
                calendarWeek: nextSchool[0].calendarWeek,
                startDate: new Date(nextSchool[0].startDate),
            };
        }

        return defaultResult;
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching calendar:', error);
        return defaultResult;
    }
}

/**
 * Fetch activity report (Taetigkeitsnachweis) status.
 */
export async function fetchReportStatus(userId: string): Promise<ReportStatus> {
    const defaultResult: ReportStatus = {
        draft: 0,
        submitted: 0,
        approved: 0,
        rejected: 0,
        currentWeekExists: false,
    };

    try {
        // Count reports by status
        const statusCounts = await db.execute(sql`
            SELECT status, COUNT(*) as cnt
            FROM activity_reports
            WHERE trainee_id = ${userId}
            GROUP BY status
        `);

        for (const row of statusCounts as any[]) {
            const s = row.status as string;
            const c = Number(row.cnt);
            if (s === 'DRAFT') defaultResult.draft = c;
            else if (s === 'SUBMITTED') defaultResult.submitted = c;
            else if (s === 'APPROVED') defaultResult.approved = c;
            else if (s === 'REJECTED') defaultResult.rejected = c;
        }

        // Check if current week report exists
        const now = new Date();
        const currentYear = now.getFullYear();
        // ISO week calculation
        const janFirst = new Date(currentYear, 0, 1);
        const dayOfYear = Math.floor((now.getTime() - janFirst.getTime()) / 86400000) + 1;
        const currentWeek = Math.ceil((dayOfYear + janFirst.getDay()) / 7);

        const weekCheck = await db
            .select({ id: activityReports.id })
            .from(activityReports)
            .where(and(
                eq(activityReports.traineeId, userId),
                eq(activityReports.weekNumber, currentWeek),
                eq(activityReports.year, currentYear),
            ))
            .limit(1);

        defaultResult.currentWeekExists = weekCheck.length > 0;

        return defaultResult;
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching report status:', error);
        return defaultResult;
    }
}

/**
 * Fetch notification summary.
 */
export async function fetchNotifications(userId: string): Promise<NotificationInfo> {
    try {
        // Unread count
        const unreadResult = await db
            .select({ cnt: count() })
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.isRead, false),
            ));
        const unreadCount = Number(unreadResult[0]?.cnt) || 0;

        // 5 most recent titles
        const recent = await db
            .select({ title: notifications.title })
            .from(notifications)
            .where(eq(notifications.userId, userId))
            .orderBy(desc(notifications.createdAt))
            .limit(5);

        return {
            unreadCount,
            recentTitles: recent.map(n => n.title),
        };
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching notifications:', error);
        return { unreadCount: 0, recentTitles: [] };
    }
}

// ============================================================================
// TRAINER FETCHERS
// ============================================================================

/**
 * Fetch pending review counts for a trainer.
 */
export async function fetchTrainerPendingReviews(trainerId: string): Promise<TrainerPendingReviews> {
    const defaultResult: TrainerPendingReviews = {
        pendingEnablerSubmissions: 0,
        pendingUseCaseSubmissions: 0,
        pendingQuizReviews: 0,
        pendingReportReviews: 0,
    };

    try {
        // Pending enabler submissions from trainees assigned to this trainer
        const enablerSubs = await db.execute(sql`
            SELECT COUNT(*) as cnt
            FROM enabler_submissions es
            JOIN profiles p ON p.id = es.trainee_id AND p.assigned_trainer_id = ${trainerId}
            WHERE es.status = 'PENDING'
        `);
        defaultResult.pendingEnablerSubmissions = Number((enablerSubs as any[])[0]?.cnt) || 0;

        // Pending use case submissions
        const ucSubs = await db.execute(sql`
            SELECT COUNT(*) as cnt
            FROM use_case_submissions ucs
            JOIN profiles p ON p.id = ucs.trainee_id AND p.assigned_trainer_id = ${trainerId}
            WHERE ucs.status = 'PENDING'
        `);
        defaultResult.pendingUseCaseSubmissions = Number((ucSubs as any[])[0]?.cnt) || 0;

        // Pending quiz reviews (unreviewed submissions)
        const quizSubs = await db.execute(sql`
            SELECT COUNT(*) as cnt
            FROM quiz_submissions qs
            JOIN profiles p ON p.id = qs.trainee_id AND p.assigned_trainer_id = ${trainerId}
            WHERE qs.is_reviewed = false
        `);
        defaultResult.pendingQuizReviews = Number((quizSubs as any[])[0]?.cnt) || 0;

        // Pending activity report reviews (SUBMITTED status)
        const reportSubs = await db.execute(sql`
            SELECT COUNT(*) as cnt
            FROM activity_reports ar
            JOIN profiles p ON p.id = ar.trainee_id AND p.assigned_trainer_id = ${trainerId}
            WHERE ar.status = 'SUBMITTED'
        `);
        defaultResult.pendingReportReviews = Number((reportSubs as any[])[0]?.cnt) || 0;

        return defaultResult;
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching trainer reviews:', error);
        return defaultResult;
    }
}

/**
 * Fetch overview of all trainees assigned to a trainer.
 */
export async function fetchTrainerTraineeOverview(trainerId: string): Promise<TrainerTraineeInfo[]> {
    try {
        // Get all trainees assigned to this trainer
        const trainees = await db
            .select({
                id: profiles.id,
                fullName: profiles.fullName,
                firstName: profiles.firstName,
                lastName: profiles.lastName,
            })
            .from(profiles)
            .where(and(
                eq(profiles.assignedTrainerId, trainerId),
                eq(profiles.role, 'TRAINEE'),
                eq(profiles.isActive, true),
            ))
            .orderBy(profiles.lastName, profiles.firstName);

        if (trainees.length === 0) return [];

        const results: TrainerTraineeInfo[] = [];

        for (const trainee of trainees) {
            // Calculate overall progress for each trainee
            const progressResult = await db.execute(sql`
                SELECT
                    COUNT(DISTINCT ec.enabler_id) AS completed,
                    COUNT(DISTINCT e.id) AS total
                FROM course_members cm
                JOIN enablers e ON e.course_id = cm.course_id AND e.is_active = true
                LEFT JOIN enabler_completions ec ON ec.enabler_id = e.id AND ec.trainee_id = ${trainee.id}
                WHERE cm.user_id = ${trainee.id}
            `);

            const row = (progressResult as any[])[0] || { completed: 0, total: 0 };
            const completed = Number(row.completed) || 0;
            const total = Number(row.total) || 0;
            const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

            results.push({
                fullName: trainee.fullName || `${trainee.firstName || ''} ${trainee.lastName || ''}`.trim() || 'Unbekannt',
                progressPercent,
            });
        }

        return results;
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching trainee overview:', error);
        return [];
    }
}

// ============================================================================
// GERMAN FORMATTERS
// ============================================================================

const BLOCK_TYPE_LABELS: Record<string, string> = {
    SCHOOL: 'Berufsschule',
    COMPANY: 'Betrieb (WMC)',
    HOLIDAY: 'Urlaub/Ferien',
    EXAM: 'Pruefungszeitraum',
    PERSONAL: 'Persoenlicher Termin',
    SONSTIGES: 'Sonstiges',
    TRAINER_BLOCKER: 'Trainer-Blocker',
};

function formatBlockType(blockType: string | null): string {
    if (!blockType) return 'Unbekannt';
    return BLOCK_TYPE_LABELS[blockType] || blockType;
}

function formatDate(date: Date): string {
    return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

function formatSnapshot(snapshot: UserSnapshot): string {
    const lines: string[] = [
        `**Nutzer:** ${snapshot.fullName} (${snapshot.role === 'TRAINER' ? 'Trainer' : 'Azubi'})`,
        `**Gesamtfortschritt:** ${snapshot.overallProgressPercent}%`,
    ];

    if (snapshot.unreadNotifications > 0) {
        lines.push(`**Ungelesene Benachrichtigungen:** ${snapshot.unreadNotifications}`);
    }

    if (snapshot.currentBlockType) {
        lines.push(`**Aktuelle Phase:** ${formatBlockType(snapshot.currentBlockType)}`);
    }

    return lines.join('\n');
}

function formatProgress(progressList: CourseProgress[]): string {
    if (progressList.length === 0) {
        return 'Der Nutzer ist in keinem aktiven Kurs eingeschrieben.';
    }

    const lines: string[] = ['**Kursfortschritt:**'];

    for (const p of progressList) {
        lines.push(`- **${p.courseTitle}**: ${p.completedEnablers}/${p.totalEnablers} Enabler (${p.progressPercent}%)`);
        if (p.latestQuizScore !== null) {
            lines.push(`  Letzte Quiz-Note: ${p.latestQuizScore.toFixed(1)}%`);
        }
        if (p.nextEnablerTitle) {
            lines.push(`  Naechster Enabler: "${p.nextEnablerTitle}"`);
        }
    }

    return lines.join('\n');
}

function formatCalendar(cal: CalendarInfo): string {
    const lines: string[] = [];

    if (cal.currentBlockType) {
        lines.push(`**Aktuelle Phase:** ${formatBlockType(cal.currentBlockType)}${cal.currentBlockTitle ? ` (${cal.currentBlockTitle})` : ''}`);
    } else {
        lines.push('**Aktuelle Phase:** Keine Blockzuordnung fuer diese Woche.');
    }

    if (cal.upcomingExams.length > 0) {
        lines.push('**Anstehende Pruefungen (naechste 14 Tage):**');
        for (const exam of cal.upcomingExams) {
            const typeLabel = exam.examType ? ` (${exam.examType})` : '';
            lines.push(`- ${exam.subject}${typeLabel}: ${formatDate(exam.examDate)}`);
        }
    } else {
        lines.push('**Anstehende Pruefungen:** Keine in den naechsten 14 Tagen.');
    }

    if (cal.nextSchoolBlock) {
        lines.push(`**Naechster Schulblock:** KW ${cal.nextSchoolBlock.calendarWeek} (ab ${formatDate(cal.nextSchoolBlock.startDate)})`);
    }

    return lines.join('\n');
}

function formatReports(reports: ReportStatus): string {
    const total = reports.draft + reports.submitted + reports.approved + reports.rejected;
    const lines: string[] = [
        `**Taetigkeitsnachweise gesamt:** ${total}`,
        `- Entwurf: ${reports.draft}`,
        `- Eingereicht: ${reports.submitted}`,
        `- Genehmigt: ${reports.approved}`,
        `- Abgelehnt: ${reports.rejected}`,
    ];

    if (!reports.currentWeekExists) {
        lines.push('**Hinweis:** Fuer die aktuelle Woche existiert noch kein Nachweis!');
    } else {
        lines.push('**Aktuelle Woche:** Nachweis vorhanden.');
    }

    return lines.join('\n');
}

function formatNotifications(notifs: NotificationInfo): string {
    const lines: string[] = [
        `**Ungelesene Benachrichtigungen:** ${notifs.unreadCount}`,
    ];

    if (notifs.recentTitles.length > 0) {
        lines.push('**Letzte Benachrichtigungen:**');
        for (const title of notifs.recentTitles) {
            lines.push(`- ${title}`);
        }
    }

    return lines.join('\n');
}

function formatTrainerReviews(reviews: TrainerPendingReviews): string {
    const total = reviews.pendingEnablerSubmissions
        + reviews.pendingUseCaseSubmissions
        + reviews.pendingQuizReviews
        + reviews.pendingReportReviews;

    if (total === 0) {
        return '**Ausstehende Bewertungen:** Keine! Alles erledigt.';
    }

    const lines: string[] = [
        `**Ausstehende Bewertungen gesamt:** ${total}`,
    ];

    if (reviews.pendingEnablerSubmissions > 0) {
        lines.push(`- Enabler-Abgaben: ${reviews.pendingEnablerSubmissions}`);
    }
    if (reviews.pendingUseCaseSubmissions > 0) {
        lines.push(`- Use-Case-Abgaben: ${reviews.pendingUseCaseSubmissions}`);
    }
    if (reviews.pendingQuizReviews > 0) {
        lines.push(`- Quiz-Bewertungen: ${reviews.pendingQuizReviews}`);
    }
    if (reviews.pendingReportReviews > 0) {
        lines.push(`- Taetigkeitsnachweise: ${reviews.pendingReportReviews}`);
    }

    return lines.join('\n');
}

function formatTraineeOverview(trainees: TrainerTraineeInfo[]): string {
    if (trainees.length === 0) {
        return '**Azubi-Uebersicht:** Keine Azubis zugewiesen.';
    }

    const lines: string[] = [
        `**Azubi-Uebersicht (${trainees.length} Azubis):**`,
    ];

    for (const t of trainees) {
        const bar = t.progressPercent >= 75 ? '+++' : t.progressPercent >= 50 ? '++' : t.progressPercent >= 25 ? '+' : '-';
        lines.push(`- ${t.fullName}: ${t.progressPercent}% ${bar}`);
    }

    return lines.join('\n');
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Fetch live data context for injection into the system prompt.
 *
 * Flow:
 * 1. Always fetch a user snapshot (~150 tokens)
 * 2. If a data intent is detected, fetch the specific data (~300 tokens)
 * 3. Return formatted German text ready for prompt injection
 *
 * @param userId - The authenticated user ID
 * @param userRole - 'TRAINER' or 'TRAINEE'
 * @param message - The user's chat message
 * @returns LiveDataContext with formatted summary, or null if all fetches fail
 */
export async function fetchDataContext(
    userId: string,
    userRole: UserRole,
    message: string
): Promise<LiveDataContext | null> {
    const startTime = Date.now();

    try {
        // Step 1: Always fetch snapshot
        const snapshot = await fetchUserSnapshot(userId);
        if (!snapshot) {
            console.warn('HAI.ai DataContext: Could not fetch user snapshot');
            return null;
        }

        // Step 2: Classify data intent
        const dataIntent = classifyDataIntent(message, userRole);

        // Step 3: Build summary parts
        const parts: string[] = [formatSnapshot(snapshot)];
        let intentTokenEstimate = 0;

        // Step 4: Fetch intent-specific data
        if (dataIntent !== 'none') {
            try {
                switch (dataIntent) {
                    case 'progress_query': {
                        const progress = await fetchTraineeProgress(userId);
                        parts.push(formatProgress(progress));
                        intentTokenEstimate = 300;
                        break;
                    }
                    case 'calendar_query': {
                        const calendar = await fetchCalendar(userId);
                        parts.push(formatCalendar(calendar));
                        intentTokenEstimate = 250;
                        break;
                    }
                    case 'exam_query': {
                        const calendar = await fetchCalendar(userId);
                        parts.push(formatCalendar(calendar));
                        intentTokenEstimate = 250;
                        break;
                    }
                    case 'report_query': {
                        const reports = await fetchReportStatus(userId);
                        parts.push(formatReports(reports));
                        intentTokenEstimate = 200;
                        break;
                    }
                    case 'notification_query': {
                        const notifs = await fetchNotifications(userId);
                        parts.push(formatNotifications(notifs));
                        intentTokenEstimate = 150;
                        break;
                    }
                    case 'review_query': {
                        if (userRole === 'TRAINER') {
                            const reviews = await fetchTrainerPendingReviews(userId);
                            parts.push(formatTrainerReviews(reviews));
                            intentTokenEstimate = 200;
                        }
                        break;
                    }
                    case 'trainee_overview': {
                        if (userRole === 'TRAINER') {
                            const overview = await fetchTrainerTraineeOverview(userId);
                            parts.push(formatTraineeOverview(overview));
                            intentTokenEstimate = 200 + overview.length * 20;
                        }
                        break;
                    }
                }
            } catch (intentError) {
                // Non-fatal: intent-specific fetch failed, still return snapshot
                console.warn(`HAI.ai DataContext: Intent fetch failed for ${dataIntent}:`, intentError);
            }
        }

        const summary = parts.join('\n\n');
        const tokenEstimate = 150 + intentTokenEstimate; // snapshot + intent data

        const elapsed = Date.now() - startTime;
        console.log(`HAI.ai: DataContext fetched in ${elapsed}ms | intent=${dataIntent} | ~${tokenEstimate} tokens`);

        return {
            summary,
            tokenEstimate,
            dataIntent,
        };
    } catch (error) {
        console.error('HAI.ai DataContext: Fatal error:', error);
        return null;
    }
}
