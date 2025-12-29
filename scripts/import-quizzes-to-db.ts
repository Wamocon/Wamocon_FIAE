/**
 * Quiz Import Script
 * 
 * Imports quiz questions from JSON files into the Supabase database.
 * Matches enablers by title/code and creates quizzes with the appropriate difficulty levels.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../src/db/migrations/schemas/schema';

const { courses, enablers, quizzes, questions, options, enablerQuizLinks } = schema;


// Types for JSON structure
interface QuizOption {
    letter: string;
    text: string;
    isCorrect: boolean;
}

interface QuizExplanation {
    whyCorrect: string;
    whyIncorrect: string;
    keyInsight: string;
}

interface QuizQuestion {
    questionNumber: number;
    topic: string;
    questionText: string;
    options: QuizOption[];
    correctAnswer: string;
    explanation: QuizExplanation;
}

interface EnablerQuiz {
    sourceFile: string;
    questions: QuizQuestion[];
}

interface EnablerData {
    enablerName: string;
    enablerCode: string;
    folderName: string;
    quizzes: {
        LOW?: EnablerQuiz;
        MEDIUM?: EnablerQuiz;
        HIGH?: EnablerQuiz;
    };
}

interface CourseData {
    courseName: string;
    folderName: string;
    parsedAt: string;
    totalEnablers: number;
    totalQuestions: number;
    enablers: EnablerData[];
}

// Configuration
const QUIZ_DATA_PATH = path.join(__dirname, '..', 'quiz_data');

// Results tracking
interface ImportResult {
    courseName: string;
    enablersMatched: number;
    enablersNotFound: string[];
    quizzesCreated: number;
    questionsImported: number;
}

async function main() {
    const { DB_CONNECTION_STRING } = process.env;
    if (!DB_CONNECTION_STRING) {
        throw new Error('DB_CONNECTION_STRING is not defined in environment variables');
    }

    console.log('🔗 Connecting to database...\n');
    const sql = postgres(DB_CONNECTION_STRING, { max: 1 });
    const db = drizzle(sql);

    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const singleCourse = args.find(a => !a.startsWith('--'));

    if (dryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made to the database\n');
    }

    // Get all JSON files
    const files = fs.readdirSync(QUIZ_DATA_PATH)
        .filter(f => f.endsWith('.json') && !f.startsWith('_'));

    // Filter if single course specified
    const filesToProcess = singleCourse
        ? files.filter(f => f.toLowerCase().includes(singleCourse.toLowerCase()))
        : files;

    console.log(`📁 Found ${filesToProcess.length} course file(s) to process\n`);

    const results: ImportResult[] = [];
    let totalQuizzesCreated = 0;
    let totalQuestionsImported = 0;

    // Get existing enablers from database
    console.log('📊 Fetching existing enablers from database...');
    const existingEnablers = await db
        .select({
            id: enablers.id,
            title: enablers.title,
            orderIndex: enablers.orderIndex,
            courseId: enablers.courseId,
        })
        .from(enablers);

    console.log(`   Found ${existingEnablers.length} enablers in database\n`);

    // Get existing courses with their creators
    const existingCourses = await db
        .select({
            id: courses.id,
            title: courses.title,
            createdById: courses.createdById,
        })
        .from(courses);

    console.log(`   Found ${existingCourses.length} courses in database\n`);

    // Get trainer ID from the first course creator
    const firstCourseCreator = existingCourses.find(c => c.createdById)?.createdById;
    if (!firstCourseCreator && !dryRun) {
        throw new Error('No course creator found in database to use as quiz creator');
    }
    const TRAINER_ID = firstCourseCreator || 'dry-run-id';
    console.log(`   Using trainer ID: ${TRAINER_ID}\n`);

    // Process each course file
    for (const file of filesToProcess) {
        const filePath = path.join(QUIZ_DATA_PATH, file);
        const courseData: CourseData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        console.log(`\n${'='.repeat(60)}`);
        console.log(`📚 Processing: ${courseData.courseName}`);
        console.log(`   Enablers: ${courseData.totalEnablers}, Questions: ${courseData.totalQuestions}`);

        const result: ImportResult = {
            courseName: courseData.courseName,
            enablersMatched: 0,
            enablersNotFound: [],
            quizzesCreated: 0,
            questionsImported: 0,
        };

        // Process each enabler in the JSON
        for (const enablerData of courseData.enablers) {
            // Try to match enabler by code or title
            const matchedEnabler = findMatchingEnabler(
                enablerData,
                existingEnablers
            );

            if (!matchedEnabler) {
                result.enablersNotFound.push(enablerData.enablerName);
                console.log(`   ⚠️  No match: ${enablerData.enablerName.substring(0, 50)}...`);
                continue;
            }

            result.enablersMatched++;
            console.log(`   ✅ Matched: ${enablerData.enablerName.substring(0, 40)}... → ${matchedEnabler.title?.substring(0, 30)}...`);

            // Process each difficulty level
            for (const [difficulty, quiz] of Object.entries(enablerData.quizzes)) {
                if (!quiz || !quiz.questions || quiz.questions.length === 0) continue;

                const difficultyKey = difficulty as 'LOW' | 'MEDIUM' | 'HIGH';

                if (!dryRun) {
                    // Check if quiz already exists for this enabler/difficulty
                    const existingLink = await db
                        .select()
                        .from(enablerQuizLinks)
                        .where(
                            and(
                                eq(enablerQuizLinks.enablerId, matchedEnabler.id),
                                eq(enablerQuizLinks.difficulty, difficultyKey)
                            )
                        )
                        .limit(1);

                    if (existingLink.length > 0) {
                        console.log(`      ⏭️  ${difficulty}: Quiz already exists, skipping`);
                        continue;
                    }

                    // Create the quiz
                    const [newQuiz] = await db
                        .insert(quizzes)
                        .values({
                            title: `${enablerData.enablerName} - ${difficulty}`,
                            quizType: 'LESSON',
                            createdById: TRAINER_ID,
                            isActive: true,
                        })
                        .returning();

                    // Link quiz to enabler with difficulty
                    await db.insert(enablerQuizLinks).values({
                        enablerId: matchedEnabler.id,
                        quizId: newQuiz.id,
                        difficulty: difficultyKey,
                    });

                    result.quizzesCreated++;
                    totalQuizzesCreated++;

                    // Insert questions
                    for (let i = 0; i < quiz.questions.length; i++) {
                        const q = quiz.questions[i];

                        // Build question text with topic if available
                        const questionText = q.topic
                            ? `**${q.topic}**\n\n${q.questionText}`
                            : q.questionText;

                        // Insert question
                        const [newQuestion] = await db
                            .insert(questions)
                            .values({
                                quizId: newQuiz.id,
                                questionText: questionText,
                                questionType: 'MCQ',
                                orderIndex: i + 1,
                            })
                            .returning();

                        // Insert options
                        for (const opt of q.options) {
                            // Build explanation for correct answer
                            const explanation = opt.isCorrect && q.explanation
                                ? `${q.explanation.whyCorrect}\n\n**Warum andere falsch:** ${q.explanation.whyIncorrect}\n\n**💡 Wichtige Erkenntnis:** ${q.explanation.keyInsight}`
                                : undefined;

                            await db.insert(options).values({
                                questionId: newQuestion.id,
                                optionText: opt.text,
                                isCorrect: opt.isCorrect,
                                explanation: explanation,
                            });
                        }

                        result.questionsImported++;
                        totalQuestionsImported++;
                    }

                    console.log(`      ✅ ${difficulty}: ${quiz.questions.length} questions imported`);
                } else {
                    console.log(`      📋 ${difficulty}: ${quiz.questions.length} questions (dry run)`);
                    result.questionsImported += quiz.questions.length;
                    result.quizzesCreated++;
                }
            }
        }

        results.push(result);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(60));

    let totalMatched = 0;
    let totalNotFound = 0;

    for (const r of results) {
        console.log(`\n${r.courseName.substring(0, 50)}...`);
        console.log(`   Enablers Matched: ${r.enablersMatched}`);
        console.log(`   Enablers Not Found: ${r.enablersNotFound.length}`);
        console.log(`   Quizzes Created: ${r.quizzesCreated}`);
        console.log(`   Questions Imported: ${r.questionsImported}`);
        totalMatched += r.enablersMatched;
        totalNotFound += r.enablersNotFound.length;
    }

    console.log('\n' + '-'.repeat(60));
    console.log(`TOTAL Enablers Matched: ${totalMatched}`);
    console.log(`TOTAL Enablers Not Found: ${totalNotFound}`);
    console.log(`TOTAL Quizzes Created: ${totalQuizzesCreated}`);
    console.log(`TOTAL Questions Imported: ${totalQuestionsImported}`);

    if (dryRun) {
        console.log('\n⚠️  This was a DRY RUN - no changes were made to the database');
    }

    // Save report
    const reportPath = path.join(QUIZ_DATA_PATH, '_import_report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
        importedAt: new Date().toISOString(),
        dryRun,
        totals: {
            enablersMatched: totalMatched,
            enablersNotFound: totalNotFound,
            quizzesCreated: totalQuizzesCreated,
            questionsImported: totalQuestionsImported,
        },
        results,
    }, null, 2));

    console.log(`\n📝 Report saved to: ${reportPath}`);

    await sql.end({ timeout: 1 });
    console.log('\n✅ Import complete!');
}

/**
 * Find matching enabler in database by title
 */
function findMatchingEnabler(
    enablerData: EnablerData,
    existingEnablers: { id: string; title: string; orderIndex: number; courseId: string }[]
): { id: string; title: string } | null {
    // Extract enabler code from folder name (e.g., "01_Rechte und Pflichten...")
    const folderMatch = enablerData.folderName.match(/^(\d+)_(.+)$/);
    const orderIndex = folderMatch ? parseInt(folderMatch[1]) : null;
    const titleFromFolder = folderMatch ? folderMatch[2] : enablerData.folderName;

    // Try to match by title similarity
    const normalizedTitle = normalizeTitle(titleFromFolder);

    for (const e of existingEnablers) {
        if (!e.title) continue;
        const normalizedDbTitle = normalizeTitle(e.title);

        // Check for significant overlap
        if (normalizedDbTitle.includes(normalizedTitle.substring(0, 20)) ||
            normalizedTitle.includes(normalizedDbTitle.substring(0, 20))) {
            return e;
        }
    }

    // Try matching by order index pattern in title
    if (orderIndex) {
        const indexPattern = new RegExp(`^0*${orderIndex}[_\\s]`);
        for (const e of existingEnablers) {
            if (e.title && indexPattern.test(e.title)) {
                return e;
            }
        }
    }

    return null;
}

function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

main().catch((err) => {
    console.error('❌ Import failed:', err);
    process.exit(1);
});
