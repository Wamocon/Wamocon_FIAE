import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  courses,
  courseMembers,
  enablers,
  enablerQuizLinks,
  quizSubmissions,
  enablerSubmissions,
  useCases,
  useCaseSubmissions,
} from '@/db/migrations/schemas/schema';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';

// Passing score threshold for quizzes (50%)
const PASS_THRESHOLD = 50;

// Calculate enabler completion with STRICT criteria:
// - If enabler has quizzes: ALL quizzes must be passed (score >= 50%)
// - If enabler has scenarios: ALL scenario submissions must be approved
// - If no quizzes and no scenarios: enabler is considered complete (content-only)
async function calculateEnablerCompletion(
  traineeId: string,
  enablerRows: Array<{ id: any; scenarioPdfUrl: string | null }>,
  quizLinks: Array<{ enablerId: any; quizId: any }>,
  quizBestScores: Map<string, number>,
  approvedEnablerSubs: Set<string>
): Promise<{ completedCount: number; completedIds: Set<string> }> {
  const completedIds = new Set<string>();

  for (const enabler of enablerRows) {
    const enablerId = String(enabler.id);

    // Check quizzes for this enabler
    const enablerQuizzes = quizLinks.filter(
      l => String(l.enablerId) === enablerId
    );
    let quizzesComplete = true;

    if (enablerQuizzes.length > 0) {
      // ALL quizzes must be passed
      for (const link of enablerQuizzes) {
        const score = quizBestScores.get(String(link.quizId)) || 0;
        if (score < PASS_THRESHOLD) {
          quizzesComplete = false;
          break;
        }
      }
    }
    // If no quizzes, quizzesComplete remains true

    // Check scenarios (enabler submissions)
    const hasScenarios = !!enabler.scenarioPdfUrl;
    let scenariosComplete = true;

    if (hasScenarios) {
      // Must have approved submission
      scenariosComplete = approvedEnablerSubs.has(enablerId);
    }
    // If no scenarios, scenariosComplete remains true

    // Enabler is complete ONLY if BOTH quizzes AND scenarios are complete
    if (quizzesComplete && scenariosComplete) {
      completedIds.add(enablerId);
    }
  }

  return { completedCount: completedIds.size, completedIds };
}

// GET courses for a trainee with STRICT progress calculation
// An enabler is complete ONLY when:
// - ALL linked quizzes are passed (score >= 50%)
// - ALL scenarios are approved by trainer
// query: traineeId
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    if (!traineeId)
      return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const data = await apiCache.getOrFetch(
      `trainee_courses_${traineeId}`,
      async () => {
        const memberships = await db
          .select()
          .from(courseMembers)
          .where(eq(courseMembers.userId, traineeId));
        const courseIds: string[] = memberships.map(m => m.courseId);
        if (!courseIds.length) return { courses: [] };

        const rows = await db
          .select()
          .from(courses)
          .where(inArray(courses.id, courseIds));
        const enablerRows = await db
          .select({
            id: enablers.id,
            courseId: enablers.courseId,
            scenarioPdfUrl: enablers.scenarioPdfUrl,
          })
          .from(enablers)
          .where(
            and(
              inArray(enablers.courseId, courseIds),
              eq(enablers.isActive, true)
            )
          )
          .orderBy(enablers.orderIndex);

        const allEnablerIds = enablerRows.map(e => e.id);
        if (allEnablerIds.length === 0) {
          return {
            courses: rows.map(c => ({
              id: c.id,
              title: c.title,
              year: c.year,
              chapter: c.chapter,
              progress: 0,
              enablerCount: 0,
              completedCount: 0,
            })),
          };
        }

        // Get all quiz submissions by this trainee WITH scores
        const userQuizSubs = await db
          .select({
            quizId: quizSubmissions.quizId,
            score: quizSubmissions.score,
          })
          .from(quizSubmissions)
          .where(eq(quizSubmissions.traineeId, traineeId));

        // Map quizId -> highest score achieved
        const quizBestScores = new Map<string, number>();
        for (const s of userQuizSubs) {
          const qid = String(s.quizId);
          const currentBest = quizBestScores.get(qid) || 0;
          if ((s.score || 0) > currentBest) {
            quizBestScores.set(qid, s.score || 0);
          }
        }

        // Get all enabler_quiz_links
        const quizLinks = await db
          .select({
            enablerId: enablerQuizLinks.enablerId,
            quizId: enablerQuizLinks.quizId,
          })
          .from(enablerQuizLinks)
          .where(inArray(enablerQuizLinks.enablerId, allEnablerIds as any));

        // Get enabler submissions (scenarios) - APPROVED ones only
        const enablerSubRows = await db
          .select({ enablerId: enablerSubmissions.enablerId })
          .from(enablerSubmissions)
          .where(
            and(
              eq(enablerSubmissions.traineeId, traineeId as any),
              inArray(enablerSubmissions.enablerId, allEnablerIds as any),
              eq(enablerSubmissions.status, 'APPROVED')
            )
          );
        const approvedEnablerSubs = new Set(
          enablerSubRows.map(r => String(r.enablerId))
        );

        // Get use cases for these courses - need ALL to be approved for course completion
        const useCaseRows = await db
          .select({ id: useCases.id, courseId: useCases.courseId })
          .from(useCases)
          .where(
            and(
              inArray(useCases.courseId, courseIds as any),
              eq(useCases.isActive, true)
            )
          );

        // Get use case submissions - APPROVED ones
        const useCaseIds = useCaseRows.map(u => u.id);
        const useCaseSubRows =
          useCaseIds.length > 0
            ? await db
              .select({ useCaseId: useCaseSubmissions.useCaseId })
              .from(useCaseSubmissions)
              .where(
                and(
                  eq(useCaseSubmissions.traineeId, traineeId as any),
                  inArray(useCaseSubmissions.useCaseId, useCaseIds as any),
                  eq(useCaseSubmissions.status, 'APPROVED')
                )
              )
            : [];
        const approvedUseCases = new Set(
          useCaseSubRows.map(r => String(r.useCaseId))
        );

        // Calculate progress per course
        const result = rows.map(c => {
          const courseEnablers = enablerRows.filter(
            e => String(e.courseId) === String(c.id)
          );
          const totalEnablers = courseEnablers.length;

          // Get use cases for this course
          const courseUseCases = useCaseRows.filter(
            u => String(u.courseId) === String(c.id)
          );
          const totalUseCases = courseUseCases.length;
          const approvedUseCaseCount = courseUseCases.filter(u =>
            approvedUseCases.has(String(u.id))
          ).length;

          if (totalEnablers === 0 && totalUseCases === 0) {
            return {
              id: c.id,
              title: c.title,
              year: c.year,
              chapter: c.chapter,
              progress: 0,
              enablerCount: 0,
              completedCount: 0,
            };
          }

          // Count completed enablers with STRICT logic
          let completedCount = 0;
          for (const enabler of courseEnablers) {
            const enablerId = String(enabler.id);

            // Check ALL quizzes for this enabler
            const enablerQuizzes = quizLinks.filter(
              l => String(l.enablerId) === enablerId
            );
            let allQuizzesPassed = true;

            if (enablerQuizzes.length > 0) {
              for (const link of enablerQuizzes) {
                const score = quizBestScores.get(String(link.quizId)) || 0;
                if (score < PASS_THRESHOLD) {
                  allQuizzesPassed = false;
                  break;
                }
              }
            }

            // Check scenarios - must be approved
            const hasScenarios = !!enabler.scenarioPdfUrl;
            let scenariosApproved = true;
            if (hasScenarios) {
              scenariosApproved = approvedEnablerSubs.has(enablerId);
            }

            // Enabler complete ONLY if ALL quizzes passed AND ALL scenarios approved
            if (allQuizzesPassed && scenariosApproved) {
              completedCount++;
            }
          }

          // Calculate weighted progress:
          // - Enablers: 70% weight
          // - Use Cases: 30% weight (if any)
          const enablerProgress =
            totalEnablers > 0 ? completedCount / totalEnablers : 1;
          const useCaseProgress =
            totalUseCases > 0 ? approvedUseCaseCount / totalUseCases : 1;

          let progress: number;
          if (totalEnablers > 0 && totalUseCases > 0) {
            progress = Math.round(
              (enablerProgress * 0.7 + useCaseProgress * 0.3) * 100
            );
          } else if (totalEnablers > 0) {
            progress = Math.round(enablerProgress * 100);
          } else {
            progress = Math.round(useCaseProgress * 100);
          }

          return {
            id: c.id,
            title: c.title,
            year: c.year,
            chapter: c.chapter,
            progress,
            enablerCount: totalEnablers,
            completedCount,
          };
        });

        return { courses: result };
      },
      ApiCache.TTL.MEDIUM
    );

    return NextResponse.json(data, { headers: cacheHeaders.medium });
  } catch (e) {
    console.error('Trainee courses GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
