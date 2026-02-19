/**
 * HAI.ai Trainee Data Indexer
 *
 * Serializes trainee-specific data (schedules, exams, progress, profile)
 * into text and embeds it into the vector database with userId metadata.
 *
 * This enables HAI to answer personal questions like:
 *   - "Wann habe ich meine nächste Prüfung?"
 *   - "Wie ist mein Fortschritt in Kurs X?"
 *   - "In welcher Ausbildungswoche bin ich?"
 *
 * Each trainee's data is embedded with `metadata.userId` so that vector search
 * only returns their own personal data (not another trainee's).
 *
 * @module lib/hai/traineeDataIndexer
 */

import haiDb from '@/db/haiDb';
import { sql, eq, and, desc, gte, lte, count, inArray } from 'drizzle-orm';
import {
  profiles,
  courses,
  courseMembers,
  enablers,
  enablerCompletions,
  enablerSubmissions,
  quizSubmissions,
  ausbildungBlocks,
  schoolExams,
  schoolExamResults,
  activityReports,
  lernfelder,
} from '@/db/migrations/schemas/schema';
import { indexContent, type SourceType } from './embeddings';

// ============================================================================
// TYPES
// ============================================================================

export interface TraineeIndexResult {
  traineeId: string;
  traineeName: string;
  profileResult: { success: boolean; chunks: number };
  scheduleResult: { success: boolean; chunks: number };
  progressResult: { success: boolean; chunks: number };
  errors: string[];
}

export interface AllTraineesIndexResult {
  totalTrainees: number;
  successfullyIndexed: number;
  failed: number;
  results: TraineeIndexResult[];
}

// ============================================================================
// TRAINEE PROFILE
// ============================================================================

/**
 * Serialize trainee profile data into embeddable text
 */
async function buildTraineeProfileText(
  traineeId: string
): Promise<string | null> {
  try {
    const profileResult = await haiDb
      .select({
        fullName: profiles.fullName,
        firstName: profiles.firstName,
        email: profiles.email,
        role: profiles.role,
        startOfTrainingDate: profiles.startOfTrainingDate,
      })
      .from(profiles)
      .where(eq(profiles.id, traineeId))
      .limit(1);

    if (profileResult.length === 0) return null;
    const p = profileResult[0];

    // Get enrolled courses
    const enrolledCourses = await haiDb
      .select({
        courseTitle: courses.title,
        year: courses.year,
        chapter: courses.chapter,
      })
      .from(courseMembers)
      .innerJoin(courses, eq(courses.id, courseMembers.courseId))
      .where(
        and(eq(courseMembers.userId, traineeId), eq(courses.isActive, true))
      );

    // Get trainer info
    const trainerResult = await haiDb.execute(sql`
            SELECT t.full_name, t.email
            FROM profiles p
            JOIN profiles t ON t.id = p.assigned_trainer_id
            WHERE p.id = ${traineeId}
            LIMIT 1
        `);
    const trainer = (trainerResult as any[])[0];

    const lines: string[] = [
      `# Profil: ${p.fullName || p.firstName || 'Auszubildende/r'}`,
      ``,
      `Name: ${p.fullName || p.firstName || 'Unbekannt'}`,
      `E-Mail: ${p.email}`,
      `Rolle: Auszubildende/r (Trainee)`,
    ];

    if (p.startOfTrainingDate) {
      const startDate = new Date(p.startOfTrainingDate);
      lines.push(`Ausbildungsbeginn: ${startDate.toLocaleDateString('de-DE')}`);

      // Calculate training year
      const now = new Date();
      const monthsDiff =
        (now.getFullYear() - startDate.getFullYear()) * 12 +
        (now.getMonth() - startDate.getMonth());
      const trainingYear = Math.floor(monthsDiff / 12) + 1;
      lines.push(`Aktuelles Ausbildungsjahr: ${trainingYear}`);
    }

    if (trainer) {
      lines.push(`Ausbilder: ${trainer.full_name} (${trainer.email})`);
    }

    if (enrolledCourses.length > 0) {
      lines.push(``, `## Eingeschriebene Kurse (${enrolledCourses.length}):`);
      for (const c of enrolledCourses) {
        lines.push(`- ${c.courseTitle} (Jahr ${c.year}, Kapitel ${c.chapter})`);
      }
    }

    return lines.join('\n');
  } catch (error) {
    console.error(
      `HAI.ai TraineeIndexer: Error building profile for ${traineeId}:`,
      error
    );
    return null;
  }
}

// ============================================================================
// TRAINEE SCHEDULE & EXAMS
// ============================================================================

/**
 * Serialize trainee schedule (ausbildung blocks + school exams) into embeddable text
 */
async function buildTraineeScheduleText(
  traineeId: string
): Promise<string | null> {
  try {
    // Get profile name for context
    const profile = await haiDb
      .select({ fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.id, traineeId))
      .limit(1);
    const name = profile[0]?.fullName || 'Auszubildende/r';

    // Get ALL ausbildung blocks (sorted by date)
    const blocks = await haiDb
      .select({
        blockType: ausbildungBlocks.blockType,
        startDate: ausbildungBlocks.startDate,
        endDate: ausbildungBlocks.endDate,
        schuljahr: ausbildungBlocks.schuljahr,
        ausbildungsjahr: ausbildungBlocks.ausbildungsjahr,
        examSubType: ausbildungBlocks.examSubType,
      })
      .from(ausbildungBlocks)
      .where(eq(ausbildungBlocks.traineeId, traineeId))
      .orderBy(ausbildungBlocks.startDate);

    // Get ALL school exams (sorted by date)
    const exams = await haiDb
      .select({
        subject: schoolExams.subject,
        examDate: schoolExams.examDate,
        examTypeValue: schoolExams.examTypeValue,
        lernfeldCode: schoolExams.lernfeldCode,
        notes: schoolExams.notes,
      })
      .from(schoolExams)
      .where(eq(schoolExams.traineeId, traineeId))
      .orderBy(schoolExams.examDate);

    // Get exam results
    const examResults = await haiDb
      .select({
        examId: schoolExamResults.examId,
        grade: schoolExamResults.grade,
        points: schoolExamResults.points,
        percentage: schoolExamResults.percentage,
        passed: schoolExamResults.passed,
      })
      .from(schoolExamResults)
      .where(eq(schoolExamResults.traineeId, traineeId));
    const resultMap = new Map(examResults.map(r => [r.examId, r]));

    if (blocks.length === 0 && exams.length === 0) {
      return null; // No schedule data
    }

    const lines: string[] = [`# Zeitplan & Prüfungen: ${name}`, ``];

    // Current date context
    const now = new Date();
    lines.push(`Stand: ${now.toLocaleDateString('de-DE')}`);
    lines.push(``);

    // Ausbildung Blocks
    if (blocks.length > 0) {
      lines.push(`## Ausbildungsblöcke (${blocks.length} Einträge):`);

      // Identify current block
      const currentBlock = blocks.find(b => {
        const start = new Date(b.startDate);
        const end = new Date(b.endDate);
        return now >= start && now <= end;
      });

      if (currentBlock) {
        lines.push(
          `**Aktueller Block:** ${currentBlock.blockType} (${new Date(currentBlock.startDate).toLocaleDateString('de-DE')} - ${new Date(currentBlock.endDate).toLocaleDateString('de-DE')})`
        );
      }

      lines.push(``);
      for (const b of blocks) {
        const start = new Date(b.startDate).toLocaleDateString('de-DE');
        const end = new Date(b.endDate).toLocaleDateString('de-DE');
        const isCurrent = currentBlock === b ? ' [AKTUELL]' : '';
        const isPast = new Date(b.endDate) < now ? ' [vergangen]' : '';
        const examInfo = b.examSubType ? ` (${b.examSubType})` : '';
        lines.push(
          `- ${b.blockType}${examInfo}: ${start} - ${end} (${b.schuljahr}, AJ ${b.ausbildungsjahr})${isCurrent}${isPast}`
        );
      }
    }

    // School Exams
    if (exams.length > 0) {
      lines.push(``, `## Prüfungen & Klausuren (${exams.length}):`);

      const upcoming = exams.filter(e => new Date(e.examDate) >= now);
      const past = exams.filter(e => new Date(e.examDate) < now);

      if (upcoming.length > 0) {
        lines.push(``, `### Anstehende Prüfungen:`);
        for (const e of upcoming) {
          const date = new Date(e.examDate).toLocaleDateString('de-DE');
          const type = e.examTypeValue ? ` (${e.examTypeValue})` : '';
          const lf = e.lernfeldCode ? ` [${e.lernfeldCode}]` : '';
          lines.push(`- ${date}: ${e.subject}${type}${lf}`);
          if (e.notes) lines.push(`  Hinweis: ${e.notes}`);
        }
      }

      if (past.length > 0) {
        lines.push(``, `### Vergangene Prüfungen:`);
        for (const e of past) {
          const date = new Date(e.examDate).toLocaleDateString('de-DE');
          const result = resultMap.get((e as any).id);
          let resultText = '(kein Ergebnis)';
          if (result) {
            resultText = `Note: ${result.grade}`;
            if (result.points != null)
              resultText += ` (${result.points} Punkte)`;
            if (result.percentage != null)
              resultText += ` ${result.percentage}%`;
            resultText += result.passed ? ' ✓ bestanden' : ' ✗ nicht bestanden';
          }
          lines.push(`- ${date}: ${e.subject} → ${resultText}`);
        }
      }
    }

    return lines.join('\n');
  } catch (error) {
    console.error(
      `HAI.ai TraineeIndexer: Error building schedule for ${traineeId}:`,
      error
    );
    return null;
  }
}

// ============================================================================
// TRAINEE PROGRESS
// ============================================================================

/**
 * Serialize trainee learning progress into embeddable text
 */
async function buildTraineeProgressText(
  traineeId: string
): Promise<string | null> {
  try {
    const profile = await haiDb
      .select({ fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.id, traineeId))
      .limit(1);
    const name = profile[0]?.fullName || 'Auszubildende/r';

    // Get enrolled courses with enabler progress
    const enrolledCourses = await haiDb
      .select({
        courseId: courseMembers.courseId,
        courseTitle: courses.title,
        year: courses.year,
      })
      .from(courseMembers)
      .innerJoin(courses, eq(courses.id, courseMembers.courseId))
      .where(
        and(eq(courseMembers.userId, traineeId), eq(courses.isActive, true))
      );

    if (enrolledCourses.length === 0) return null;

    const lines: string[] = [
      `# Lernfortschritt: ${name}`,
      ``,
      `Stand: ${new Date().toLocaleDateString('de-DE')}`,
      ``,
    ];

    let totalCompleted = 0;
    let totalEnablers = 0;

    for (const course of enrolledCourses) {
      const courseEnablers = await haiDb
        .select({ id: enablers.id, title: enablers.title })
        .from(enablers)
        .where(
          and(
            eq(enablers.courseId, course.courseId),
            eq(enablers.isActive, true)
          )
        )
        .orderBy(enablers.orderIndex);

      if (courseEnablers.length === 0) continue;

      const enablerIds = courseEnablers.map(e => e.id);
      const completed = await haiDb
        .select({ enablerId: enablerCompletions.enablerId })
        .from(enablerCompletions)
        .where(
          and(
            eq(enablerCompletions.traineeId, traineeId),
            inArray(enablerCompletions.enablerId, enablerIds)
          )
        );
      const completedSet = new Set(completed.map(c => c.enablerId));

      const completedCount = completedSet.size;
      totalCompleted += completedCount;
      totalEnablers += courseEnablers.length;
      const pct = Math.round((completedCount / courseEnablers.length) * 100);

      lines.push(`## ${course.courseTitle} (Jahr ${course.year})`);
      lines.push(
        `Fortschritt: ${completedCount}/${courseEnablers.length} Enabler (${pct}%)`
      );

      // Show incomplete enablers
      const incomplete = courseEnablers.filter(e => !completedSet.has(e.id));
      if (incomplete.length > 0 && incomplete.length <= 10) {
        lines.push(`Noch offen:`);
        for (const e of incomplete) {
          lines.push(`  - ${e.title}`);
        }
      } else if (incomplete.length > 10) {
        lines.push(`Noch ${incomplete.length} Enabler offen`);
      } else {
        lines.push(`✓ Alle Enabler abgeschlossen!`);
      }
      lines.push(``);
    }

    // Overall progress
    const overallPct =
      totalEnablers > 0
        ? Math.round((totalCompleted / totalEnablers) * 100)
        : 0;
    lines.splice(
      3,
      0,
      `Gesamtfortschritt: ${totalCompleted}/${totalEnablers} Enabler (${overallPct}%)`
    );

    // Activity reports
    const reportCounts = await haiDb.execute(sql`
            SELECT status, COUNT(*) as cnt
            FROM activity_reports
            WHERE trainee_id = ${traineeId}
            GROUP BY status
        `);
    if ((reportCounts as any[]).length > 0) {
      lines.push(`## Tätigkeitsnachweise:`);
      for (const row of reportCounts as any[]) {
        lines.push(`- ${row.status}: ${row.cnt}`);
      }
    }

    // Latest quiz scores
    const latestQuizzes = await haiDb.execute(sql`
            SELECT q.title as quiz_title, qs.score, qs.submitted_at
            FROM quiz_submissions qs
            JOIN quizzes q ON q.id = qs.quiz_id
            WHERE qs.trainee_id = ${traineeId}
            ORDER BY qs.submitted_at DESC
            LIMIT 5
        `);
    if ((latestQuizzes as any[]).length > 0) {
      lines.push(``, `## Letzte Quiz-Ergebnisse:`);
      for (const q of latestQuizzes as any[]) {
        const date = new Date(q.submitted_at).toLocaleDateString('de-DE');
        lines.push(`- ${q.quiz_title}: ${q.score}% (${date})`);
      }
    }

    return lines.join('\n');
  } catch (error) {
    console.error(
      `HAI.ai TraineeIndexer: Error building progress for ${traineeId}:`,
      error
    );
    return null;
  }
}

// ============================================================================
// INDEX FUNCTIONS
// ============================================================================

/**
 * Index all personal data for a single trainee.
 * Creates embeddings for profile, schedule/exams, and progress.
 * Each embedding includes `userId` in metadata for filtered retrieval.
 */
export async function indexTraineeData(
  traineeId: string
): Promise<TraineeIndexResult> {
  const result: TraineeIndexResult = {
    traineeId,
    traineeName: '',
    profileResult: { success: false, chunks: 0 },
    scheduleResult: { success: false, chunks: 0 },
    progressResult: { success: false, chunks: 0 },
    errors: [],
  };

  try {
    // Get trainee name
    const profile = await haiDb
      .select({ fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.id, traineeId))
      .limit(1);
    result.traineeName = profile[0]?.fullName || 'Unknown';

    // 1. Index profile
    const profileText = await buildTraineeProfileText(traineeId);
    if (profileText) {
      const profileIndexResult = await indexContent({
        sourceType: 'trainee_profile' as SourceType,
        sourceId: traineeId,
        title: `Profil: ${result.traineeName}`,
        content: profileText,
        metadata: {
          userId: traineeId,
          dataType: 'profile',
          indexedAt: new Date().toISOString(),
        },
      });
      result.profileResult = {
        success: profileIndexResult.success,
        chunks: profileIndexResult.chunksIndexed,
      };
      if (!profileIndexResult.success && profileIndexResult.error) {
        result.errors.push(`Profile: ${profileIndexResult.error}`);
      }
    }

    // 2. Index schedule & exams
    const scheduleText = await buildTraineeScheduleText(traineeId);
    if (scheduleText) {
      const scheduleIndexResult = await indexContent({
        sourceType: 'trainee_schedule' as SourceType,
        sourceId: traineeId,
        title: `Zeitplan: ${result.traineeName}`,
        content: scheduleText,
        metadata: {
          userId: traineeId,
          dataType: 'schedule',
          indexedAt: new Date().toISOString(),
        },
      });
      result.scheduleResult = {
        success: scheduleIndexResult.success,
        chunks: scheduleIndexResult.chunksIndexed,
      };
      if (!scheduleIndexResult.success && scheduleIndexResult.error) {
        result.errors.push(`Schedule: ${scheduleIndexResult.error}`);
      }
    }

    // 3. Index learning progress
    const progressText = await buildTraineeProgressText(traineeId);
    if (progressText) {
      const progressIndexResult = await indexContent({
        sourceType: 'trainee_progress' as SourceType,
        sourceId: traineeId,
        title: `Lernfortschritt: ${result.traineeName}`,
        content: progressText,
        metadata: {
          userId: traineeId,
          dataType: 'progress',
          indexedAt: new Date().toISOString(),
        },
      });
      result.progressResult = {
        success: progressIndexResult.success,
        chunks: progressIndexResult.chunksIndexed,
      };
      if (!progressIndexResult.success && progressIndexResult.error) {
        result.errors.push(`Progress: ${progressIndexResult.error}`);
      }
    }
  } catch (error) {
    result.errors.push(
      `Fatal: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return result;
}

/**
 * Index personal data for ALL trainees in the system.
 * Iterates all users with role TRAINEE and indexes their data.
 */
export async function indexAllTrainees(): Promise<AllTraineesIndexResult> {
  const allResult: AllTraineesIndexResult = {
    totalTrainees: 0,
    successfullyIndexed: 0,
    failed: 0,
    results: [],
  };

  try {
    // Get all trainees
    const trainees = await haiDb
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.role, 'TRAINEE'));

    allResult.totalTrainees = trainees.length;
    console.log(
      `HAI.ai TraineeIndexer: Starting indexing for ${trainees.length} trainees`
    );

    for (const trainee of trainees) {
      console.log(
        `HAI.ai TraineeIndexer: Indexing ${trainee.fullName} (${trainee.id})...`
      );
      const traineeResult = await indexTraineeData(trainee.id);
      allResult.results.push(traineeResult);

      const hasSuccess =
        traineeResult.profileResult.success ||
        traineeResult.scheduleResult.success ||
        traineeResult.progressResult.success;

      if (hasSuccess) {
        allResult.successfullyIndexed++;
      } else if (traineeResult.errors.length > 0) {
        allResult.failed++;
      } else {
        // No data to index (not a failure)
        allResult.successfullyIndexed++;
      }
    }

    console.log(
      `HAI.ai TraineeIndexer: Done. ${allResult.successfullyIndexed} indexed, ${allResult.failed} failed`
    );
  } catch (error) {
    console.error('HAI.ai TraineeIndexer: Fatal error:', error);
  }

  return allResult;
}

/**
 * Index all enabler and course content from the production database.
 * This is the main content indexer for shared learning materials.
 */
export async function indexAllContent(): Promise<{
  enablersIndexed: number;
  coursesIndexed: number;
  errors: string[];
}> {
  const result = {
    enablersIndexed: 0,
    coursesIndexed: 0,
    errors: [] as string[],
  };

  try {
    // 1. Index all courses
    const allCourses = await haiDb
      .select({
        id: courses.id,
        title: courses.title,
        year: courses.year,
        chapter: courses.chapter,
      })
      .from(courses)
      .where(eq(courses.isActive, true));

    for (const course of allCourses) {
      const courseText = `# Kurs: ${course.title}\nJahr: ${course.year}\nKapitel: ${course.chapter}`;
      const indexResult = await indexContent({
        sourceType: 'course',
        sourceId: course.id,
        title: course.title,
        content: courseText,
        metadata: {
          courseId: course.id,
          year: course.year,
          chapter: course.chapter,
        },
      });
      if (indexResult.success || indexResult.chunksIndexed > 0) {
        result.coursesIndexed++;
      }
    }

    // 2. Index all enablers with their text content
    const allEnablers = await haiDb
      .select({
        id: enablers.id,
        title: enablers.title,
        courseId: enablers.courseId,
        descriptionText: enablers.descriptionText,
      })
      .from(enablers)
      .where(eq(enablers.isActive, true));

    for (const enabler of allEnablers) {
      // Build combined text from all enabler fields
      const parts: string[] = [`# Enabler: ${enabler.title}`];
      if (enabler.descriptionText)
        parts.push(`\n## Beschreibung\n${enabler.descriptionText}`);

      const enablerText = parts.join('\n');
      if (enablerText.length < 20) continue; // Skip empty enablers

      // Get course title for metadata
      const courseInfo = allCourses.find(c => c.id === enabler.courseId);

      const indexResult = await indexContent({
        sourceType: 'enabler',
        sourceId: enabler.id,
        title: enabler.title,
        content: enablerText,
        metadata: {
          courseId: enabler.courseId,
          courseTitle: courseInfo?.title || '',
        },
      });
      if (indexResult.success || indexResult.chunksIndexed > 0) {
        result.enablersIndexed++;
      } else if (indexResult.error) {
        result.errors.push(`Enabler ${enabler.title}: ${indexResult.error}`);
      }
    }
  } catch (error) {
    result.errors.push(
      `Fatal: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return result;
}
