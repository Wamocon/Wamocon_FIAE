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
    trainingCatalogs,
    TRAINING_CATALOG_IDS,
} from '@/db/migrations/schemas/schema';
import { toHaiRole } from '@/lib/auth-helpers';
import { isTrainerLevelRole } from '@/lib/auth/roles';
import { buildHaiTrainingScope } from './trainingScope';
import { getCatalogScopeForUserId } from '@/lib/catalog/scope';
import { loadTraineeProgress } from '@/lib/trainer/trainee-progress';
import { loadPhasePlan } from '@/lib/catalog/phase-plan-db';
import { traineeSearchNotFoundLine } from './denial';
import { formatDayProgress, loadDayProgress } from './dayProgress';
import type { DayProgress } from './dayProgress';
import type { HaiTrainingScope } from './trainingScope';
import {
    answerDocumentQuestion,
    type DocumentAccess,
    type DocumentScope,
} from './documentQuery';

// ============================================================================
// TYPES
// ============================================================================

import {
    extractPotentialTraineeName,
    isTraineeListQuestion,
    resolveDataIntent,
} from './dataIntent';
import type {
    DataIntent,
    HistoryTurnMessage,
    UserRole,
} from './dataIntent';
export * from './dataIntent';


export interface LiveDataContext {
    /** Formatted German text ready for system prompt injection */
    summary: string;
    /** Estimated token count for budget tracking */
    tokenEstimate: number;
    /** Which data intent was detected */
    dataIntent: DataIntent;
    /** document_query: files whose pages the PageIndex loads (a named file) */
    documentIds?: string[];
}

/** What the pipeline knows about the turn, only used for the day companion. */
export interface DataContextOptions {
    /** Code of the occupation chosen in the app (x-catalog): only the order of the progress per occupation. */
    preferredCatalogCode?: string | null;
    /** Training scope of the trainee (phase plan), for the next step. */
    trainingScope?: Pick<HaiTrainingScope, 'currentPhase' | 'allowedComponentPhases'>;
    /**
     * What the person may read (from the database, never from the request): the
     * occupations, the audience and the organization. Without it a question about
     * files gets the neutral answer (fail closed).
     */
    documentAccess?: DocumentAccess | null;
    /** Records of the page the person is on (ids already checked by the page context). */
    page?: DocumentScope | null;
    /**
     * The earlier messages of the session (server side): a short follow-up of a
     * trainer ("Welche mit Namen?") asks for the list of the own trainees again.
     */
    previousMessages?: readonly HistoryTurnMessage[];
}

export interface UserSnapshot {
    fullName: string;
    role: UserRole;
    overallProgressPercent: number;
    unreadNotifications: number;
    currentBlockType: string | null;
    ausbildungPlanLabel?: string;
    currentAusbildungsjahr?: number;
    currentTrainingPhase?: number;
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
    /**
     * Only set for a trainee in several occupations: a report belongs to one
     * occupation, so the numbers above are those of the default occupation and
     * this list gives every occupation its own numbers.
     */
    occupations?: ReportStatusOccupation[];
}

export interface ReportStatusOccupation {
    code: string;
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

/** One occupation of an assigned trainee (a trainee can be in several). */
export interface TrainerTraineeOccupation {
    title: string;
    /** Short code of the occupation (FIAE, KFBM), used in the compact list. */
    code: string | null;
    /** Year of training (1 to 3), from the block calendar or the start date. */
    trainingYear: number | null;
    /** Block type of today in the block calendar of this occupation. */
    currentBlockType: string | null;
}

/**
 * One assigned, active trainee in the overview of a trainer. Metadata only:
 * no e-mail address, no date of birth, no grades.
 */
export interface TrainerTraineeInfo {
    fullName: string;
    progressPercent: number;
    occupations: TrainerTraineeOccupation[];
    /** Open items waiting for the trainer to review (submissions, reports). */
    pendingSubmissions: number;
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
                startOfTrainingDate: profiles.startOfTrainingDate,
                ausbildungDurationYears: profiles.ausbildungDurationYears,
            })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        if (user.length === 0) return null;

        const displayName = user[0].fullName || user[0].firstName || 'Nutzer';
        // Privileged roles (ADMIN, TEMP_ADMIN) are treated as TRAINER so HAI
        // builds the trainer-facing context for them.
        const role = toHaiRole(user[0].role);

        // Only content of the user's catalogs (fail closed: no scope, no progress)
        const catalogScope = await getCatalogScopeForUserId(userId);
        // Phase one of the trainee's occupation (KfBM 15 months, FIAE 18)
        const phasePlan =
            role === 'TRAINEE' && user[0].startOfTrainingDate
                ? await loadPhasePlan(
                    catalogScope?.activeCatalogId,
                    user[0].ausbildungDurationYears
                )
                : null;
        const trainingScope = buildHaiTrainingScope({
            role,
            startOfTrainingDate: user[0].startOfTrainingDate,
            ausbildungDurationYears: user[0].ausbildungDurationYears,
            phaseOneMonths: phasePlan?.phaseMonths[0],
        });

        const snapshotCatalogIds = sql.join(
            (catalogScope?.allowedCatalogIds ?? []).map(id => sql`${id}::uuid`),
            sql`, `
        );

        // Get overall progress (completed enablers / total active enablers across enrolled courses)
        const progressResult = catalogScope ? await db.execute(sql`
            SELECT
                COUNT(DISTINCT ec.enabler_id) AS completed,
                COUNT(DISTINCT e.id) AS total
            FROM course_members cm
            JOIN enablers e ON e.course_id = cm.course_id AND e.is_active = true
                AND e.training_catalog_id IN (${snapshotCatalogIds})
            LEFT JOIN enabler_completions ec ON ec.enabler_id = e.id AND ec.trainee_id = ${userId}
            WHERE cm.user_id = ${userId}
        `) : [];

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
            ausbildungPlanLabel: trainingScope?.planLabel,
            currentAusbildungsjahr: trainingScope?.currentAusbildungsjahr,
            currentTrainingPhase: trainingScope?.currentPhase,
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
        // Only content of the user's catalogs (fail closed: no scope, no content)
        const catalogScope = await getCatalogScopeForUserId(userId);
        if (!catalogScope) return [];

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
                inArray(courses.trainingCatalogId, catalogScope.allowedCatalogIds),
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
                ? ((latestQuiz as any[])[0].score === null
                    ? null
                    : Number((latestQuiz as any[])[0].score))
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
 * Fetch activity report (Taetigkeitsnachweis) status. A report belongs to one
 * occupation, so the numbers are counted per occupation: with `catalogId` for
 * that occupation only, without it for every occupation of the trainee (a
 * trainee in one occupation gets the plain numbers, one in several gets the
 * default occupation plus a list with each occupation, see ReportStatus).
 * Fail closed: without a catalog scope nothing is counted.
 */
export async function fetchReportStatus(
    userId: string,
    catalogId?: string | null
): Promise<ReportStatus> {
    const defaultResult: ReportStatus = {
        draft: 0,
        submitted: 0,
        approved: 0,
        rejected: 0,
        currentWeekExists: false,
    };

    try {
        const catalogScope = catalogId ? null : await getCatalogScopeForUserId(userId);
        const catalogIds = catalogId ? [catalogId] : (catalogScope?.allowedCatalogIds ?? []);
        if (catalogIds.length === 0) return defaultResult;
        const defaultCatalogId = catalogId ?? catalogScope!.activeCatalogId;

        const perCatalog = new Map<string, Omit<ReportStatusOccupation, 'code'>>(
            catalogIds.map(id => [id, { draft: 0, submitted: 0, approved: 0, rejected: 0, currentWeekExists: false }])
        );

        // Count reports by occupation and status
        const statusCounts = await db
            .select({
                catalogId: activityReports.trainingCatalogId,
                status: activityReports.status,
                cnt: count(),
            })
            .from(activityReports)
            .where(and(
                eq(activityReports.traineeId, userId),
                inArray(activityReports.trainingCatalogId, catalogIds),
            ))
            .groupBy(activityReports.trainingCatalogId, activityReports.status);

        for (const row of statusCounts) {
            const entry = perCatalog.get(String(row.catalogId));
            if (!entry) continue;
            const s = row.status as string;
            const c = Number(row.cnt);
            if (s === 'DRAFT') entry.draft = c;
            else if (s === 'SUBMITTED') entry.submitted = c;
            else if (s === 'APPROVED') entry.approved = c;
            else if (s === 'REJECTED') entry.rejected = c;
        }

        // Check if current week report exists
        const now = new Date();
        const currentYear = now.getFullYear();
        // ISO week calculation
        const janFirst = new Date(currentYear, 0, 1);
        const dayOfYear = Math.floor((now.getTime() - janFirst.getTime()) / 86400000) + 1;
        const currentWeek = Math.ceil((dayOfYear + janFirst.getDay()) / 7);

        const weekCheck = await db
            .selectDistinct({ catalogId: activityReports.trainingCatalogId })
            .from(activityReports)
            .where(and(
                eq(activityReports.traineeId, userId),
                inArray(activityReports.trainingCatalogId, catalogIds),
                eq(activityReports.weekNumber, currentWeek),
                eq(activityReports.year, currentYear),
            ));
        for (const row of weekCheck) {
            const entry = perCatalog.get(String(row.catalogId));
            if (entry) entry.currentWeekExists = true;
        }

        const own = perCatalog.get(defaultCatalogId) ?? perCatalog.get(catalogIds[0])!;
        Object.assign(defaultResult, own);

        if (catalogIds.length > 1) {
            const codeRows = await db
                .select({ id: trainingCatalogs.id, code: trainingCatalogs.code })
                .from(trainingCatalogs)
                .where(inArray(trainingCatalogs.id, catalogIds));
            const codes = new Map(codeRows.map(r => [String(r.id), String(r.code)]));
            defaultResult.occupations = catalogIds.map(id => ({
                code: codes.get(id) ?? id,
                ...perCatalog.get(id)!,
            }));
        }

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
        // Only content of the user's catalogs (fail closed: no scope, no content)
        const catalogScope = await getCatalogScopeForUserId(userId);
        if (!catalogScope) return [];
        const catalogIds = sql.join(
            catalogScope.allowedCatalogIds.map(id => sql`${id}::uuid`),
            sql`, `
        );

        const results = await db.execute(sql`
            SELECT
                c.title AS course_title,
                COUNT(DISTINCT uc.id) AS total,
                COUNT(DISTINCT CASE WHEN ucs.status = 'APPROVED' THEN uc.id END) AS completed,
                COUNT(DISTINCT CASE WHEN ucs.status = 'PENDING' THEN uc.id END) AS pending
            FROM course_members cm
            JOIN courses c ON c.id = cm.course_id AND c.training_catalog_id IN (${catalogIds})
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
 * Year of training (1 to the duration) from a start date, null when the start
 * is unknown, invalid or still in the future.
 */
export function trainingYearFrom(
    start: Date | string | null | undefined,
    now: Date,
    durationYears: number | null | undefined
): number | null {
    if (!start) return null;
    const startDate = start instanceof Date ? start : new Date(start);
    if (Number.isNaN(startDate.getTime()) || startDate.getTime() > now.getTime()) {
        return null;
    }
    const months =
        (now.getFullYear() - startDate.getFullYear()) * 12 +
        (now.getMonth() - startDate.getMonth());
    const maxYears = durationYears && durationYears > 0 ? durationYears : 3;
    return Math.min(Math.max(Math.floor(months / 12) + 1, 1), maxYears);
}

/** Block types that say where the trainee is today (no private appointments). */
const OVERVIEW_BLOCK_TYPES = ['SCHOOL', 'COMPANY', 'HOLIDAY', 'EXAM'] as const;

/**
 * Fetch the overview of the active trainees assigned to a trainer
 * (profiles.assigned_trainer_id): name, occupation per enrollment, year of
 * training, block of today, progress in percent and the number of open items
 * waiting for the review. Metadata only: no e-mail address, no date of birth,
 * no grades. One query per fact for all trainees together (no query per
 * trainee).
 */
export async function fetchTrainerTraineeOverview(trainerId: string): Promise<TrainerTraineeInfo[]> {
    try {
        // Get all active trainees assigned to this trainer
        const trainees = await db
            .select({
                id: profiles.id,
                fullName: profiles.fullName,
                firstName: profiles.firstName,
                lastName: profiles.lastName,
                startOfTrainingDate: profiles.startOfTrainingDate,
                durationYears: profiles.ausbildungDurationYears,
            })
            .from(profiles)
            .where(and(
                eq(profiles.assignedTrainerId, trainerId),
                eq(profiles.role, 'TRAINEE'),
                eq(profiles.isActive, true),
            ))
            .orderBy(profiles.lastName, profiles.firstName);

        if (trainees.length === 0) return [];

        const idList = sql.join(trainees.map(t => sql`${t.id}`), sql`, `);
        const now = new Date();
        // a raw query cannot bind a Date (postgres.js needs a column type): an ISO
        // string cast to the type of the columns (timestamp, written as UTC)
        const nowIso = now.toISOString();

        // Everything else in one query per fact, for all trainees at once
        // The progress is the ONE figure of the platform (an enabler counts when
        // its required quizzes are passed). The rows of enabler_completions are
        // not it: the quiz based completion does not write them, so counting them
        // showed 0 % for every trainee (found on the real Preview).
        const [progressLoaded, enrollmentRows, catalogRows, blockRows, pendingRows] =
            (await Promise.all([
                loadTraineeProgress(trainees.map(t => String(t.id)), null),
                db.execute(sql`
                    SELECT te.trainee_id, te.training_catalog_id, te.start_date, te.duration_years
                    FROM trainee_enrollments te
                    WHERE te.trainee_id IN (${idList})
                `),
                db.execute(sql`SELECT id, code, title FROM training_catalogs`),
                db.execute(sql`
                    SELECT DISTINCT ON (b.trainee_id, b.training_catalog_id)
                           b.trainee_id, b.training_catalog_id, b.block_type, b.ausbildungsjahr
                    FROM ausbildung_blocks b
                    WHERE b.trainee_id IN (${idList})
                      AND b.block_type IN (${sql.join(OVERVIEW_BLOCK_TYPES.map(t => sql`${t}`), sql`, `)})
                      AND b.start_date <= ${nowIso}::timestamp
                      AND b.end_date >= ${nowIso}::timestamp
                    ORDER BY b.trainee_id, b.training_catalog_id, b.start_date DESC
                `),
                db.execute(sql`
                    SELECT p.id AS trainee_id,
                           (
                             (SELECT COUNT(*) FROM enabler_submissions es WHERE es.trainee_id = p.id AND es.status = 'PENDING')
                             + (SELECT COUNT(*) FROM use_case_submissions ucs WHERE ucs.trainee_id = p.id AND ucs.status = 'PENDING')
                             + (SELECT COUNT(*) FROM quiz_submissions qs WHERE qs.trainee_id = p.id AND qs.is_reviewed = false)
                             + (SELECT COUNT(*) FROM activity_reports ar WHERE ar.trainee_id = p.id AND ar.status = 'SUBMITTED')
                           ) AS pending
                    FROM profiles p
                    WHERE p.id IN (${idList})
                `),
            ])) as [Awaited<ReturnType<typeof loadTraineeProgress>>, any[], any[], any[], any[]];

        const pendingById = new Map<string, number>();
        for (const r of pendingRows ?? []) {
            pendingById.set(String(r.trainee_id), Number(r.pending) || 0);
        }
        const catalogById = new Map<string, { code: string | null; title: string }>();
        for (const r of catalogRows ?? []) {
            catalogById.set(String(r.id), { code: r.code ?? null, title: r.title ?? 'Beruf unbekannt' });
        }
        const enrollmentsById = new Map<string, any[]>();
        for (const r of enrollmentRows ?? []) {
            const list = enrollmentsById.get(String(r.trainee_id)) ?? [];
            list.push(r);
            enrollmentsById.set(String(r.trainee_id), list);
        }
        const blockByKey = new Map<string, { blockType: string | null; year: number | null }>();
        for (const r of blockRows ?? []) {
            blockByKey.set(`${r.trainee_id}:${r.training_catalog_id}`, {
                blockType: r.block_type ?? null,
                year: r.ausbildungsjahr != null ? Number(r.ausbildungsjahr) : null,
            });
        }

        return trainees.map(trainee => {
            const id = String(trainee.id);
            const progressPercent = progressLoaded.byTrainee.get(id)?.pct ?? 0;

            // No enrollment at all: the standard occupation (FIAE), like the catalog scope
            const enrollments = enrollmentsById.get(id) ?? [
                { training_catalog_id: TRAINING_CATALOG_IDS.FIAE, start_date: null, duration_years: trainee.durationYears },
            ];
            const occupations: TrainerTraineeOccupation[] = enrollments.map(en => {
                const catalogId = String(en.training_catalog_id);
                const catalog = catalogById.get(catalogId);
                const block = blockByKey.get(`${id}:${catalogId}`);
                const duration = Number(en.duration_years) || trainee.durationYears || 3;
                return {
                    title: catalog?.title ?? 'Beruf unbekannt',
                    code: catalog?.code ?? null,
                    trainingYear:
                        block?.year ??
                        trainingYearFrom(en.start_date ?? trainee.startOfTrainingDate, now, duration),
                    currentBlockType: block?.blockType ?? null,
                };
            });

            return {
                fullName: trainee.fullName || `${trainee.firstName || ''} ${trainee.lastName || ''}`.trim() || 'Unbekannt',
                progressPercent,
                occupations,
                pendingSubmissions: pendingById.get(id) ?? 0,
            };
        });
    } catch (error) {
        // Not an empty list: "no trainees" would be a false statement. The
        // caller treats a failed fetch as non-fatal (snapshot only).
        console.error('HAI.ai DataContext: Error fetching trainee overview:', error);
        throw error;
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
    nameQuery: string,
    found?: { id: string; fullName: string } | null
): Promise<string> {
    const trainee = found ?? (await findTraineeByName(trainerId, nameQuery));
    if (!trainee) {
        // ZUSTAENDIGKEIT: only the own trainees count, a person of another
        // trainer answers like a person that does not exist (denial.ts)
        return traineeSearchNotFoundLine(nameQuery);
    }

    const parts: string[] = [`**Azubi-Detail: ${trainee.fullName}**`];

    try {
        // 1. Overall progress per course: the figure of the platform (required
        // quizzes passed), not the rows of enabler_completions (always empty for
        // the quiz based completion)
        const loadedProgress = await loadTraineeProgress([String(trainee.id)], null);
        const ownProgress = loadedProgress.byTrainee.get(String(trainee.id));
        const courseProgress = [...(ownProgress?.courses ?? new Map())]
            .map(([courseId, figure]) => ({
                course: loadedProgress.courses.get(courseId),
                completed: figure.completed,
                total: figure.total,
            }))
            .filter(row => row.course && row.total > 0)
            .sort(
                (a, b) =>
                    (a.course!.chapter ?? 0) - (b.course!.chapter ?? 0) ||
                    a.course!.title.localeCompare(b.course!.title, 'de')
            );

        if (courseProgress.length > 0) {
            parts.push('**Kursfortschritt:**');
            for (const row of courseProgress) {
                const pct = Math.round((row.completed / row.total) * 100);
                parts.push(`- ${row.course!.title}: ${row.completed}/${row.total} Enabler (${pct}%)`);
            }
        }

        // 2. Recent submissions (last 10)
        const submissions = await db.execute(sql`
            (
                SELECT 'enabler' as type, e.title, es.status, es.submitted_at, es.trainer_feedback
                FROM enabler_submissions es
                JOIN enablers e ON e.id = es.enabler_id
                WHERE es.trainee_id = ${trainee.id}
                ORDER BY es.submitted_at DESC LIMIT 5
            )
            UNION ALL
            (
                SELECT 'use_case' as type, uc.title, ucs.status, ucs.submitted_at, ucs.trainer_feedback
                FROM use_case_submissions ucs
                JOIN use_cases uc ON uc.id = ucs.use_case_id
                WHERE ucs.trainee_id = ${trainee.id}
                ORDER BY ucs.submitted_at DESC LIMIT 5
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
            JOIN school_exams se ON se.id = ser.exam_id
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

        // 4. Report status, per occupation (a report belongs to one occupation)
        const reports = await db.execute(sql`
            SELECT tc.code AS catalog_code, ar.status, COUNT(*) as cnt
            FROM activity_reports ar
            JOIN training_catalogs tc ON tc.id = ar.training_catalog_id
            WHERE ar.trainee_id = ${trainee.id}
            GROUP BY tc.code, ar.status
            ORDER BY tc.code
        `);

        if ((reports as any[]).length > 0) {
            const byCatalog = new Map<string, Record<string, number>>();
            for (const r of reports as any[]) {
                const code = String(r.catalog_code);
                const reportMap = byCatalog.get(code) ?? {};
                reportMap[r.status] = Number(r.cnt);
                byCatalog.set(code, reportMap);
            }
            const reportLabels: Record<string, string> = {
                DRAFT: 'Entwurf', SUBMITTED: 'Eingereicht', APPROVED: 'Genehmigt', REVISION_NEEDED: 'Korrektur noetig',
            };
            for (const [code, reportMap] of byCatalog) {
                const reportParts = Object.entries(reportMap)
                    .map(([status, cnt]) => `${reportLabels[status] || status}: ${cnt}`)
                    .join(', ');
                parts.push(
                    byCatalog.size > 1
                        ? `**Nachweise ${code}:** ${reportParts}`
                        : `**Nachweise:** ${reportParts}`
                );
            }
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
        `**Nutzer:** ${snapshot.fullName} (${isTrainerLevelRole(snapshot.role) ? 'Ausbilder' : 'Azubi'})`,
        `**Gesamtfortschritt:** ${snapshot.overallProgressPercent}%`,
    ];

    if (snapshot.ausbildungPlanLabel) {
        lines.push(`**Ausbildungsplan:** ${snapshot.ausbildungPlanLabel}`);
    }

    if (snapshot.currentAusbildungsjahr) {
        lines.push(`**Aktuelles Ausbildungsjahr:** ${snapshot.currentAusbildungsjahr}`);
    }

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
    // A trainee in several occupations: every occupation has its own reports
    if (reports.occupations && reports.occupations.length > 1) {
        const blocks = reports.occupations.map(o => {
            const sum = o.draft + o.submitted + o.approved + o.rejected;
            return [
                `**Taetigkeitsnachweise ${o.code} gesamt:** ${sum}`,
                `- Entwurf: ${o.draft}`,
                `- Eingereicht: ${o.submitted}`,
                `- Genehmigt: ${o.approved}`,
                `- Abgelehnt: ${o.rejected}`,
                o.currentWeekExists
                    ? `**Aktuelle Woche (${o.code}):** Nachweis vorhanden.`
                    : `**Hinweis:** Fuer die aktuelle Woche existiert in ${o.code} noch kein Nachweis!`,
            ].join('\n');
        });
        return blocks.join('\n');
    }
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

/**
 * What is empty on the day of a trainee, in words, so the answer can name it
 * ("Für heute sind keine Termine eingetragen") instead of "no data". Returns
 * null when nothing is missing. When every area is empty it says so too, the
 * answer then suggests to go on learning.
 */
export function formatDayGaps(input: {
    progress: DayProgress;
    calendar: CalendarInfo;
    reports: ReportStatus;
    submissions: SubmissionInfo[];
    notifs: NotificationInfo;
}): string | null {
    const { progress, calendar, reports, submissions, notifs } = input;
    const lines: string[] = [];

    const noAppointments =
        !calendar.currentBlockType &&
        calendar.upcomingExams.length === 0 &&
        !calendar.nextSchoolBlock;
    if (noAppointments) {
        lines.push('- Termine: Für heute und die nächsten 14 Tage sind keine Termine eingetragen (keine Blockzuordnung, keine Prüfung, kein Schulblock).');
    }
    if (submissions.length === 0) {
        lines.push('- Abgaben: Es gibt noch keine Abgaben und damit keine Rückmeldungen.');
    }
    if (notifs.unreadCount === 0) {
        lines.push('- Benachrichtigungen: Keine ungelesenen.');
    }

    const reportTotal = reports.draft + reports.submitted + reports.approved + reports.rejected;
    const nothingToReport =
        noAppointments &&
        progress.occupations.length === 0 &&
        !progress.failed &&
        submissions.length === 0 &&
        notifs.unreadCount === 0 &&
        notifs.recentTitles.length === 0 &&
        reportTotal === 0;
    if (nothingToReport) {
        lines.push('- Insgesamt: Zu Terminen, Lernfortschritt, Abgaben, Nachweisen und Benachrichtigungen liegt aktuell nichts vor. Sage das ehrlich und schlage einen Schritt vor, zum Beispiel weiter lernen.');
    }

    if (lines.length === 0) return null;
    return ['**Leere Bereiche (nenne sie konkret, nicht pauschal "keine Daten"):**', ...lines].join('\n');
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

/** From this number on the list is written compactly (short codes, one line each). */
export const TRAINEE_OVERVIEW_COMPACT_FROM = 31;
/** More trainees than this are counted but not listed one by one. */
export const TRAINEE_OVERVIEW_MAX_LINES = 100;

export function formatTraineeOverview(trainees: TrainerTraineeInfo[]): string {
    if (trainees.length === 0) {
        return '**Azubi-Übersicht:** Dir sind keine aktiven Azubis zugeordnet.';
    }

    const compact = trainees.length >= TRAINEE_OVERVIEW_COMPACT_FROM;
    const lines: string[] = [
        `**Azubi-Übersicht (${trainees.length} aktive Azubis, die dir zugeordnet sind):**`,
        'Nur Metadaten: keine Noten, keine Kontaktdaten. Details zu einer Person nur auf Nachfrage mit Namen.',
    ];

    const listed = trainees.slice(0, TRAINEE_OVERVIEW_MAX_LINES);
    for (const t of listed) {
        const occupations = t.occupations.length > 0 ? t.occupations : [];
        if (compact) {
            const occ = occupations
                .map(o => {
                    const bits = [
                        o.code || o.title,
                        o.trainingYear ? `J${o.trainingYear}` : null,
                        o.currentBlockType ? formatBlockType(o.currentBlockType) : null,
                    ].filter(Boolean);
                    return bits.join(' ');
                })
                .join(' / ');
            lines.push(
                `- ${t.fullName} (${[occ, `${t.progressPercent} %`, `${t.pendingSubmissions} offen`]
                    .filter(Boolean)
                    .join(', ')})`
            );
            continue;
        }
        const occText = occupations
            .map(o => {
                const bits = [
                    o.trainingYear ? `Ausbildungsjahr ${o.trainingYear}` : null,
                    o.currentBlockType ? `aktuell ${formatBlockType(o.currentBlockType)}` : null,
                ].filter(Boolean);
                return bits.length > 0 ? `${o.title} (${bits.join(', ')})` : o.title;
            })
            .join(' und ');
        const open =
            t.pendingSubmissions === 0
                ? 'keine offenen Abgaben zur Prüfung'
                : `${t.pendingSubmissions} offene Abgabe${t.pendingSubmissions === 1 ? '' : 'n'} zur Prüfung`;
        lines.push(
            `- ${t.fullName} | Beruf: ${occText || 'unbekannt'} | Fortschritt ${t.progressPercent} % | ${open}`
        );
    }

    if (trainees.length > listed.length) {
        lines.push(
            `... und ${trainees.length - listed.length} weitere Azubis (Liste gekürzt). Frage nach einem Namen für Details.`
        );
    }

    return lines.join('\n');
}

/**
 * The live data of an intent could not be loaded (a failed query). A line for
 * the prompt that names it as a technical failure, never as a missing right,
 * and keeps the model from naming a number or a name from memory.
 */
export function dataUnavailableLine(intent: DataIntent): string {
    const what =
        intent === 'trainee_overview'
            ? '**Azubi-Übersicht:** Die Liste konnte gerade nicht geladen werden.'
            : '**Hinweis:** Die Daten zu dieser Frage konnten gerade nicht geladen werden.';
    return `${what} Das ist eine technische Störung und keine fehlende Berechtigung. Nenne dazu keine Zahlen, Namen oder Werte und sage kurz, dass die Daten gerade nicht geladen werden konnten. Bitte darum, die Frage gleich noch einmal zu stellen.`;
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
    message: string,
    options: DataContextOptions = {}
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
        const dataIntent = resolveDataIntent(message, userRole, options.previousMessages);

        // Step 3: Build summary parts
        const parts: string[] = [formatSnapshot(snapshot)];
        let intentTokenEstimate = 0;
        let documentIds: string[] | undefined;

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
                    case 'learning_query': {
                        // Only what the trainee sees in the platform anyway:
                        // progress with the latest quiz score, upcoming exams
                        const progress = await fetchTraineeProgress(userId);
                        parts.push(formatProgress(progress));
                        const calendar = await fetchCalendar(userId);
                        parts.push(formatCalendar(calendar));
                        intentTokenEstimate = 550;
                        break;
                    }
                    case 'day_briefing': {
                        // Only what the person sees in the platform anyway, the
                        // short version: trainees get progress with the next step
                        // (per occupation, the chosen one first), appointments,
                        // report status, feedback on submissions and
                        // notifications, trainers get the open reviews and
                        // notifications. Across all occupations of the person.
                        if (userRole === 'TRAINER') {
                            const reviews = await fetchTrainerPendingReviews(userId);
                            parts.push(formatTrainerReviews(reviews));
                            const notifs = await fetchNotifications(userId);
                            parts.push(formatNotifications(notifs));
                            intentTokenEstimate = 350;
                        } else {
                            const plan = options.trainingScope
                                ? {
                                    currentPhase: options.trainingScope.currentPhase,
                                    allowedStages: options.trainingScope.allowedComponentPhases,
                                }
                                : null;
                            const dayProgress = await loadDayProgress(userId, {
                                preferredCatalogCode: options.preferredCatalogCode,
                                plan,
                            });
                            parts.push(formatDayProgress(dayProgress, options.preferredCatalogCode));
                            const calendar = await fetchCalendar(userId);
                            parts.push(formatCalendar(calendar));
                            const reports = await fetchReportStatus(userId);
                            parts.push(formatReports(reports));
                            const submissions = await fetchTraineeSubmissions(userId);
                            parts.push(formatSubmissions(submissions));
                            const notifs = await fetchNotifications(userId);
                            parts.push(formatNotifications(notifs));
                            const gaps = formatDayGaps({
                                progress: dayProgress,
                                calendar,
                                reports,
                                submissions,
                                notifs,
                            });
                            if (gaps) parts.push(gaps);
                            intentTokenEstimate = 1150;
                        }
                        break;
                    }
                    case 'document_query': {
                        // From the database, limited to the files the person may see
                        const answer = await answerDocumentQuestion({
                            message,
                            access: options.documentAccess,
                            page: options.page,
                        });
                        parts.push(answer.text);
                        if (answer.documentIds.length > 0) documentIds = answer.documentIds;
                        intentTokenEstimate = 150 + Math.min(answer.total, 20) * 40;
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
                            intentTokenEstimate = 200 + Math.min(overview.length, TRAINEE_OVERVIEW_MAX_LINES) * (overview.length >= TRAINEE_OVERVIEW_COMPACT_FROM ? 25 : 45);
                        }
                        break;
                    }
                    case 'trainee_detail_query': {
                        if (userRole === 'TRAINER') {
                            const nameCandidate = extractPotentialTraineeName(message);
                            if (nameCandidate) {
                                const trainee = await findTraineeByName(userId, nameCandidate);
                                if (trainee) {
                                    const detail = await fetchTraineeDetailForTrainer(userId, nameCandidate, trainee);
                                    parts.push(detail);
                                    intentTokenEstimate = 400;
                                } else if (
                                    isTraineeListQuestion(message) &&
                                    !nameCandidate.includes(' ')
                                ) {
                                    // No such person among the own trainees, but the
                                    // message asks for the group ("Welche Azubis ...")
                                    // and holds one word only: that word was no name,
                                    // answer with the overview. A first and last name
                                    // that is not found stays a neutral "not found".
                                    const overview = await fetchTrainerTraineeOverview(userId);
                                    parts.push(formatTraineeOverview(overview));
                                    intentTokenEstimate = 200 + overview.length * 30;
                                } else {
                                    // ZUSTAENDIGKEIT: neutral answer, a person of another
                                    // trainer answers like a person that does not exist
                                    parts.push(traineeSearchNotFoundLine(nameCandidate));
                                    intentTokenEstimate = 100;
                                }
                            }
                        }
                        break;
                    }
                }
            } catch (intentError) {
                // Non-fatal: intent-specific fetch failed, still return snapshot
                console.warn(`HAI.ai DataContext: Intent fetch failed for ${dataIntent}:`, intentError);
                // Say it plainly instead of leaving the snapshot alone: without
                // this the model only sees a few numbers and answers "no names
                // available", which reads like a missing right
                parts.push(dataUnavailableLine(dataIntent));
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
            ...(documentIds ? { documentIds } : {}),
        };
    } catch (error) {
        console.error('HAI.ai DataContext: Fatal error:', error);
        return null;
    }
}
