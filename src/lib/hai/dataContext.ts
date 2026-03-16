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
import { sql, eq, and, desc, gte, lte, count, inArray, or, ilike } from 'drizzle-orm';
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
    | 'exam_results_query'  // "Welche Note habe ich?" / "Habe ich bestanden?"
    | 'report_query'        // "Wie ist der Stand meiner Nachweise?"
    | 'submission_query'    // "Was habe ich abgegeben?" / "Welche Abgaben sind offen?"
    | 'use_case_query'      // "Welche Use Cases habe ich erledigt?"
    | 'notification_query'  // "Habe ich neue Benachrichtigungen?"
    | 'review_query'        // Trainer: "Was muss ich bewerten?"
    | 'trainee_overview'    // Trainer: "Wie stehen meine Azubis?"
    | 'trainee_detail_query' // Trainer: "Wie steht [Name]?" / "Noten von [Name]"
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

export interface ExamResultInfo {
    subject: string;
    examDate: Date;
    grade: string | null;
    points: number | null;
    percentage: number | null;
    passed: boolean | null;
}

export interface SubmissionInfo {
    type: 'enabler' | 'use_case';
    title: string;
    status: string;
    submittedAt: Date;
    trainerFeedback: string | null;
}

export interface UseCaseProgress {
    courseTitle: string;
    totalUseCases: number;
    completedUseCases: number;
    pendingUseCases: number;
    progressPercent: number;
}

export interface TrainerPendingReviews {
    pendingEnablerSubmissions: number;
    pendingUseCaseSubmissions: number;
    pendingQuizReviews: number;
    pendingReportReviews: number;
    /** Names of trainees with pending submissions */
    pendingTraineeNames: string[];
}

export interface TrainerTraineeInfo {
    fullName: string;
    progressPercent: number;
}

// ============================================================================
// DATA INTENT CLASSIFIER
// ============================================================================

// Broadened keyword sets for intent classification (natural German phrasing)
const KW_PROGRESS = ['fortschritt', 'wie weit', 'status', 'abgeschlossen', 'erledigt', 'progress', 'geschafft', 'wie viel', 'noch offen', 'wie stehe ich', 'mein stand', 'schaffe ich', 'bin ich fertig', 'komme ich voran', 'was fehlt noch'];
const KW_CALENDAR = ['kalender', 'woche', 'berufsschule', 'schulblock', 'betrieb', 'urlaub', 'ferien', 'wann habe ich', 'naechste woche', 'diese woche', 'block', 'zeitplan', 'stundenplan', 'schultag', 'frei', 'wann bin ich'];
const KW_EXAM_RESULTS = ['note', 'noten', 'bestanden', 'durchgefallen', 'ergebnis', 'punkte', 'prozent', 'wie habe ich abgeschnitten', 'klausurergebnis', 'pruefungsergebnis', 'zeugnis', 'welche note', 'meine noten', 'notenspiegel', 'notenuebersicht', 'schnitt'];
const KW_EXAM = ['pruefung', 'klausur', 'ihk', 'abschlusspruefung', 'examen', 'naechste pruefung', 'wann schreibe ich', 'ap1', 'ap2', 'teil 1', 'teil 2', 'zwischenpruefung', 'pruefungstermin'];
const KW_SUBMISSION = ['abgabe', 'abgaben', 'eingereicht', 'einreichung', 'submission', 'abgegeben', 'was habe ich abgegeben', 'feedback', 'bewertung meiner', 'rueckmeldung', 'meine loesung', 'meine abgabe', 'korrektur', 'bewertet'];
const KW_USE_CASE = ['use case', 'use-case', 'usecase', 'fallstudie', 'praktische aufgabe', 'praxisaufgabe'];
const KW_REPORT = ['nachweis', 'taetigkeitsnachweis', 'bericht', 'berichtsheft', 'wochenbericht', 'activity report', 'nachweise', 'ausbildungsnachweis', 'wie viele berichte', 'taetigkeit'];
const KW_NOTIFICATION = ['benachrichtigung', 'neuigkeiten', 'notification', 'neue nachrichten', 'was gibt es neues', 'updates', 'ungelesen', 'inbox'];
const KW_REVIEW = ['bewerten', 'ausstehend', 'korrigieren', 'review', 'eingereicht', 'submissions', 'pruefe', 'zu bewerten', 'offene abgaben', 'pending', 'was muss ich'];
const KW_OVERVIEW = ['ueberblick', 'meine azubis', 'wie stehen', 'fortschritt meiner', 'alle azubis', 'azubi-uebersicht', 'meine auszubildenden'];

// ============================================================================
// NAME EXTRACTION (for trainer → trainee queries)
// ============================================================================

/** Common German words that look like names but aren't */
const NOT_NAMES = new Set([
    'wie', 'was', 'wer', 'hat', 'von', 'der', 'die', 'das', 'ist', 'bei',
    'mit', 'nach', 'stand', 'note', 'noten', 'use', 'case', 'progress',
    'enabler', 'quiz', 'klausur', 'schulblock', 'block', 'alle', 'meine',
    'sich', 'und', 'oder', 'nicht', 'auch', 'noch', 'schon', 'mal',
    'den', 'dem', 'des', 'ein', 'eine', 'einem', 'einen', 'einer',
    'kann', 'hat', 'habe', 'haben', 'wird', 'sind', 'sein', 'seine',
    'fortschritt', 'abgaben', 'berichte', 'noten', 'ergebnis',
]);

/**
 * Extract a potential trainee name from a trainer's message.
 * Matches patterns like "von Max", "fuer Max Mustermann", "Wie steht Max?"
 */
function extractPotentialTraineeName(message: string): string | null {
    // Pattern 1: "von [Name]" / "fuer [Name]" / "zu [Name]" / "ueber [Name]"
    const prepMatch = message.match(/\b(?:von|fuer|für|zu|ueber|über)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)?)/);
    if (prepMatch) {
        const candidate = prepMatch[1].trim();
        if (!NOT_NAMES.has(candidate.toLowerCase())) return candidate;
    }

    // Pattern 2: Capitalized words that aren't at sentence start and aren't keywords
    const words = message.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
        const w = words[i].replace(/[?!.,;:]$/, '');
        if (/^[A-ZÄÖÜ][a-zäöüß]{2,}$/.test(w) && !NOT_NAMES.has(w.toLowerCase())) {
            // Check if next word is also capitalized (full name)
            const next = words[i + 1]?.replace(/[?!.,;:]$/, '');
            if (next && /^[A-ZÄÖÜ][a-zäöüß]{2,}$/.test(next) && !NOT_NAMES.has(next.toLowerCase())) {
                return `${w} ${next}`;
            }
            return w;
        }
    }

    return null;
}

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
        if (KW_REVIEW.some(k => lower.includes(k))) return 'review_query';

        // Trainee detail query: trainer mentions a specific trainee name
        const nameCandidate = extractPotentialTraineeName(message);
        if (nameCandidate) return 'trainee_detail_query';

        // "azubi" without a specific name → overview
        if (KW_OVERVIEW.some(k => lower.includes(k)) || lower.includes('azubi') || lower.includes('trainee')) {
            return 'trainee_overview';
        }
    }

    // Shared intents (both roles)
    if (KW_PROGRESS.some(k => lower.includes(k))) return 'progress_query';
    if (KW_CALENDAR.some(k => lower.includes(k))) return 'calendar_query';
    if (KW_EXAM_RESULTS.some(k => lower.includes(k))) return 'exam_results_query';
    if (KW_EXAM.some(k => lower.includes(k))) return 'exam_query';
    if (KW_SUBMISSION.some(k => lower.includes(k))) return 'submission_query';
    if (KW_USE_CASE.some(k => lower.includes(k))) return 'use_case_query';
    if (KW_REPORT.some(k => lower.includes(k))) return 'report_query';
    if (KW_NOTIFICATION.some(k => lower.includes(k))) return 'notification_query';

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
// TRAINEE FETCHERS — EXAM RESULTS, SUBMISSIONS, USE CASE PROGRESS
// ============================================================================

/**
 * Fetch exam results (grades) for the trainee.
 */
export async function fetchExamResults(userId: string): Promise<ExamResultInfo[]> {
    try {
        const results = await db.execute(sql`
            SELECT
                se.subject,
                se.exam_date,
                ser.grade,
                ser.points,
                ser.percentage,
                ser.passed
            FROM school_exam_results ser
            JOIN school_exams se ON se.id = ser.exam_id
            WHERE ser.trainee_id = ${userId}
            ORDER BY se.exam_date DESC
            LIMIT 10
        `);

        return (results as any[]).map(row => ({
            subject: row.subject,
            examDate: new Date(row.exam_date),
            grade: row.grade,
            points: row.points,
            percentage: row.percentage != null ? Number(row.percentage) : null,
            passed: row.passed,
        }));
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching exam results:', error);
        return [];
    }
}

/**
 * Fetch trainee's recent submissions (enabler + use case) with status and feedback.
 */
export async function fetchTraineeSubmissions(userId: string): Promise<SubmissionInfo[]> {
    try {
        // Enabler submissions
        const enablerSubs = await db.execute(sql`
            SELECT
                e.title,
                es.status,
                es.submitted_at,
                es.trainer_feedback
            FROM enabler_submissions es
            JOIN enablers e ON e.id = es.enabler_id
            WHERE es.trainee_id = ${userId}
            ORDER BY es.submitted_at DESC
            LIMIT 5
        `);

        // Use case submissions
        const ucSubs = await db.execute(sql`
            SELECT
                uc.title,
                ucs.status,
                ucs.submitted_at,
                ucs.trainer_feedback
            FROM use_case_submissions ucs
            JOIN use_cases uc ON uc.id = ucs.use_case_id
            WHERE ucs.trainee_id = ${userId}
            ORDER BY ucs.submitted_at DESC
            LIMIT 5
        `);

        const submissions: SubmissionInfo[] = [];

        for (const row of enablerSubs as any[]) {
            submissions.push({
                type: 'enabler',
                title: row.title,
                status: row.status,
                submittedAt: new Date(row.submitted_at),
                trainerFeedback: row.trainer_feedback,
            });
        }

        for (const row of ucSubs as any[]) {
            submissions.push({
                type: 'use_case',
                title: row.title,
                status: row.status,
                submittedAt: new Date(row.submitted_at),
                trainerFeedback: row.trainer_feedback,
            });
        }

        // Sort by date descending
        submissions.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
        return submissions.slice(0, 8);
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching submissions:', error);
        return [];
    }
}

/**
 * Fetch use-case progress per course for the trainee.
 */
export async function fetchUseCaseProgress(userId: string): Promise<UseCaseProgress[]> {
    try {
        const results = await db.execute(sql`
            SELECT
                c.title AS course_title,
                COUNT(DISTINCT uc.id) AS total,
                COUNT(DISTINCT CASE WHEN ucs.status = 'APPROVED' THEN uc.id END) AS completed,
                COUNT(DISTINCT CASE WHEN ucs.status = 'PENDING' THEN uc.id END) AS pending
            FROM course_members cm
            JOIN courses c ON c.id = cm.course_id
            JOIN use_cases uc ON uc.course_id = c.id AND uc.is_active = true
            LEFT JOIN use_case_submissions ucs ON ucs.use_case_id = uc.id AND ucs.trainee_id = ${userId}
            WHERE cm.user_id = ${userId}
            GROUP BY c.id, c.title
            HAVING COUNT(DISTINCT uc.id) > 0
            ORDER BY c.title
        `);

        return (results as any[]).map(row => {
            const total = Number(row.total) || 0;
            const completed = Number(row.completed) || 0;
            return {
                courseTitle: row.course_title,
                totalUseCases: total,
                completedUseCases: completed,
                pendingUseCases: Number(row.pending) || 0,
                progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
            };
        });
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching use case progress:', error);
        return [];
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
        pendingTraineeNames: [],
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

        // Get distinct trainee names with pending items (so trainer knows WHO)
        const pendingTrainees = await db.execute(sql`
            SELECT DISTINCT p.full_name
            FROM profiles p
            WHERE p.assigned_trainer_id = ${trainerId}
              AND p.role = 'TRAINEE'
              AND (
                EXISTS (SELECT 1 FROM enabler_submissions es WHERE es.trainee_id = p.id AND es.status = 'PENDING')
                OR EXISTS (SELECT 1 FROM use_case_submissions ucs WHERE ucs.trainee_id = p.id AND ucs.status = 'PENDING')
                OR EXISTS (SELECT 1 FROM activity_reports ar WHERE ar.trainee_id = p.id AND ar.status = 'SUBMITTED')
              )
            ORDER BY p.full_name
            LIMIT 10
        `);
        defaultResult.pendingTraineeNames = (pendingTrainees as any[])
            .map(r => r.full_name)
            .filter(Boolean);

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
// TRAINER → TRAINEE DETAIL QUERY
// ============================================================================

/**
 * Find a trainee by name who is assigned to this trainer.
 * Uses ilike for case-insensitive partial matching on fullName, firstName, lastName.
 */
async function findTraineeByName(
    trainerId: string,
    nameQuery: string
): Promise<{ id: string; fullName: string } | null> {
    try {
        const pattern = `%${nameQuery}%`;
        const results = await db
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
                or(
                    ilike(profiles.fullName, pattern),
                    ilike(profiles.firstName, pattern),
                    ilike(profiles.lastName, pattern),
                ),
            ))
            .limit(1);

        if (results.length === 0) return null;

        const r = results[0];
        return {
            id: r.id,
            fullName: r.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Unbekannt',
        };
    } catch (error) {
        console.error('HAI.ai DataContext: Error finding trainee by name:', error);
        return null;
    }
}

/**
 * Fetch detailed data for a specific trainee (called by trainer).
 * Returns a formatted German summary with progress, submissions, exam results, reports.
 */
async function fetchTraineeDetailForTrainer(
    trainerId: string,
    nameQuery: string
): Promise<string> {
    const trainee = await findTraineeByName(trainerId, nameQuery);
    if (!trainee) {
        return `**Azubi-Suche:** Kein Azubi mit dem Namen "${nameQuery}" gefunden. Bitte den vollstaendigen Namen verwenden.`;
    }

    const parts: string[] = [`**Azubi-Detail: ${trainee.fullName}**`];

    try {
        // 1. Overall progress
        const progressResult = await db.execute(sql`
            SELECT
                c.title as course_title,
                COUNT(DISTINCT e.id) AS total,
                COUNT(DISTINCT ec.enabler_id) AS completed
            FROM course_members cm
            JOIN courses c ON c.id = cm.course_id
            JOIN enablers e ON e.course_id = cm.course_id AND e.is_active = true
            LEFT JOIN enabler_completions ec ON ec.enabler_id = e.id AND ec.trainee_id = ${trainee.id}
            WHERE cm.user_id = ${trainee.id}
            GROUP BY c.id, c.title
        `);

        if ((progressResult as any[]).length > 0) {
            parts.push('**Kursfortschritt:**');
            for (const row of progressResult as any[]) {
                const pct = Number(row.total) > 0 ? Math.round((Number(row.completed) / Number(row.total)) * 100) : 0;
                parts.push(`- ${row.course_title}: ${row.completed}/${row.total} Enabler (${pct}%)`);
            }
        }

        // 2. Recent submissions (last 10)
        const submissions = await db.execute(sql`
            (
                SELECT 'enabler' as type, e.title, es.status, es.created_at as submitted_at, es.trainer_feedback
                FROM enabler_submissions es
                JOIN enablers e ON e.id = es.enabler_id
                WHERE es.trainee_id = ${trainee.id}
                ORDER BY es.created_at DESC LIMIT 5
            )
            UNION ALL
            (
                SELECT 'use_case' as type, uc.title, ucs.status, ucs.created_at as submitted_at, ucs.trainer_feedback
                FROM use_case_submissions ucs
                JOIN use_cases uc ON uc.id = ucs.use_case_id
                WHERE ucs.trainee_id = ${trainee.id}
                ORDER BY ucs.created_at DESC LIMIT 5
            )
            ORDER BY submitted_at DESC LIMIT 10
        `);

        const statusLabels: Record<string, string> = {
            PENDING: 'Ausstehend', APPROVED: 'Genehmigt', REJECTED: 'Abgelehnt',
        };

        if ((submissions as any[]).length > 0) {
            parts.push('**Letzte Abgaben:**');
            for (const s of submissions as any[]) {
                const typeLabel = s.type === 'enabler' ? 'Enabler' : 'Use Case';
                const statusLabel = statusLabels[s.status] || s.status;
                parts.push(`- [${typeLabel}] "${s.title}" — ${statusLabel}`);
            }
        }

        // 3. Exam results
        const exams = await db.execute(sql`
            SELECT se.subject, ser.grade, ser.percentage, ser.passed, se.exam_date
            FROM school_exam_results ser
            JOIN school_exams se ON se.id = ser.school_exam_id
            WHERE ser.trainee_id = ${trainee.id}
            ORDER BY se.exam_date DESC LIMIT 5
        `);

        if ((exams as any[]).length > 0) {
            parts.push('**Klausurergebnisse:**');
            for (const e of exams as any[]) {
                const examParts: string[] = [e.subject];
                if (e.grade) examParts.push(`Note: ${e.grade}`);
                if (e.percentage != null) examParts.push(`${Number(e.percentage).toFixed(0)}%`);
                if (e.passed !== null) examParts.push(e.passed ? 'Bestanden' : 'Nicht bestanden');
                parts.push(`- ${examParts.join(' | ')}`);
            }
        }

        // 4. Report status
        const reports = await db.execute(sql`
            SELECT status, COUNT(*) as cnt
            FROM activity_reports
            WHERE trainee_id = ${trainee.id}
            GROUP BY status
        `);

        if ((reports as any[]).length > 0) {
            const reportMap: Record<string, number> = {};
            for (const r of reports as any[]) {
                reportMap[r.status] = Number(r.cnt);
            }
            const reportLabels: Record<string, string> = {
                DRAFT: 'Entwurf', SUBMITTED: 'Eingereicht', APPROVED: 'Genehmigt', REVISION_NEEDED: 'Korrektur noetig',
            };
            const reportParts = Object.entries(reportMap)
                .map(([status, cnt]) => `${reportLabels[status] || status}: ${cnt}`)
                .join(', ');
            parts.push(`**Nachweise:** ${reportParts}`);
        }
    } catch (error) {
        console.error('HAI.ai DataContext: Error fetching trainee detail:', error);
        parts.push('(Einige Daten konnten nicht geladen werden.)');
    }

    return parts.join('\n');
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
        `**Nutzer:** ${snapshot.fullName} (${['ADMIN', 'TEMP_ADMIN', 'TRAINER'].includes(snapshot.role) ? 'Ausbilder' : 'Azubi'})`,
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

function formatExamResults(exams: ExamResultInfo[]): string {
    if (exams.length === 0) {
        return '**Klausurergebnisse:** Keine Ergebnisse vorhanden.';
    }

    const lines: string[] = [`**Klausurergebnisse (letzte ${exams.length}):**`];

    for (const e of exams) {
        const parts: string[] = [e.subject, formatDate(e.examDate)];
        if (e.grade) parts.push(`Note: ${e.grade}`);
        if (e.percentage != null) parts.push(`${e.percentage.toFixed(0)}%`);
        if (e.passed !== null) parts.push(e.passed ? 'Bestanden' : 'Nicht bestanden');
        lines.push(`- ${parts.join(' | ')}`);
    }

    return lines.join('\n');
}

function formatSubmissions(submissions: SubmissionInfo[]): string {
    if (submissions.length === 0) {
        return '**Abgaben:** Keine Abgaben vorhanden.';
    }

    const statusLabels: Record<string, string> = {
        PENDING: 'Ausstehend',
        APPROVED: 'Genehmigt',
        REJECTED: 'Abgelehnt',
    };

    const lines: string[] = [`**Letzte Abgaben (${submissions.length}):**`];

    for (const s of submissions) {
        const typeLabel = s.type === 'enabler' ? 'Enabler' : 'Use Case';
        const statusLabel = statusLabels[s.status] || s.status;
        lines.push(`- [${typeLabel}] "${s.title}" — ${statusLabel} (${formatDate(s.submittedAt)})`);
        if (s.trainerFeedback) {
            lines.push(`  Feedback: "${s.trainerFeedback.substring(0, 100)}${s.trainerFeedback.length > 100 ? '...' : ''}"`);
        }
    }

    return lines.join('\n');
}

function formatUseCaseProgress(progress: UseCaseProgress[]): string {
    if (progress.length === 0) {
        return '**Use-Case-Fortschritt:** Keine Use Cases zugewiesen.';
    }

    const lines: string[] = ['**Use-Case-Fortschritt:**'];

    for (const p of progress) {
        lines.push(`- **${p.courseTitle}**: ${p.completedUseCases}/${p.totalUseCases} erledigt (${p.progressPercent}%)`);
        if (p.pendingUseCases > 0) {
            lines.push(`  ${p.pendingUseCases} ausstehend zur Bewertung`);
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

    if (reviews.pendingTraineeNames.length > 0) {
        lines.push(`**Betroffene Azubis:** ${reviews.pendingTraineeNames.join(', ')}`);
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
                    case 'exam_results_query': {
                        const examResults = await fetchExamResults(userId);
                        parts.push(formatExamResults(examResults));
                        intentTokenEstimate = 300;
                        break;
                    }
                    case 'submission_query': {
                        const submissions = await fetchTraineeSubmissions(userId);
                        parts.push(formatSubmissions(submissions));
                        intentTokenEstimate = 350;
                        break;
                    }
                    case 'use_case_query': {
                        const ucProgress = await fetchUseCaseProgress(userId);
                        parts.push(formatUseCaseProgress(ucProgress));
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
                    case 'trainee_detail_query': {
                        if (userRole === 'TRAINER') {
                            const nameCandidate = extractPotentialTraineeName(message);
                            if (nameCandidate) {
                                const detail = await fetchTraineeDetailForTrainer(userId, nameCandidate);
                                parts.push(detail);
                                intentTokenEstimate = 400;
                            }
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
