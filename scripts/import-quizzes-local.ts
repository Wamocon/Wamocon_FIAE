/**
 * Local Quiz Import Script (Enabler Quizzes)
 * 
 * Imports quizzes and links them to specific enablers.
 * Each enabler can have one linked quiz (type: LESSON).
 * 
 * Usage: npx tsx -r dotenv/config scripts/import-quizzes-local.ts
 * 
 * Dry run: npx tsx -r dotenv/config scripts/import-quizzes-local.ts --dry-run
 */

import 'dotenv/config';
import db from '../src/db';
import {
    courses,
    enablers,
    quizzes,
    questions,
    options,
    enablerQuizzes,
    profiles
} from '../src/db/migrations/schemas/schema';
import * as fs from 'fs';
import * as path from 'path';
import { eq, and } from 'drizzle-orm';

interface QuizQuestion {
    questionText: string;
    options: string[]; // Array of 4 options
    correctIndex: number; // 0-3
}

interface LocalQuizEntry {
    componentName: string;
    enablerName: string;
    quizTitle: string;
    questions: QuizQuestion[];
}

interface ImportStats {
    quizzesCreated: number;
    questionsCreated: number;
    optionsCreated: number;
    linksCreated: number;
    skipped: number;
    errors: string[];
}

/**
 * Clean enabler title (remove order prefix) for matching
 */
function cleanEnablerTitle(enablerName: string): string {
    return enablerName.replace(/^\d+[_\s-]+/, '').trim();
}

async function main() {
    const isDryRun = process.argv.includes('--dry-run');

    console.log('📥 Local Quiz Import Script (Enabler Quizzes)');
    console.log('=============================================\n');

    if (isDryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    // Load quiz data
    const quizPath = path.join(__dirname, '..', 'quizzes_local.json');

    if (!fs.existsSync(quizPath)) {
        console.log('⚠️ quizzes_local.json not found.');
        console.log('   Please fill in the quiz data in quizzes_local_template.json');
        console.log('   and rename it to quizzes_local.json\n');

        const templatePath = path.join(__dirname, '..', 'quizzes_local_template.json');
        if (fs.existsSync(templatePath)) {
            console.log('   Template file exists: quizzes_local_template.json');
        }
        process.exit(1);
    }

    const quizData: LocalQuizEntry[] = JSON.parse(fs.readFileSync(quizPath, 'utf-8'));
    console.log(`📊 Loaded ${quizData.length} quiz entries\n`);

    // Find a trainer to set as quiz creator
    const [trainer] = await db.select().from(profiles).where(eq(profiles.role, 'TRAINER')).limit(1);
    if (!trainer) {
        console.error('❌ No trainer found in database. Please create a trainer profile first.');
        process.exit(1);
    }
    console.log(`👤 Using trainer: ${trainer.fullName || trainer.id}\n`);

    // Load all courses for matching
    const allCourses = await db.select().from(courses);
    const courseMap = new Map(allCourses.map(c => [c.title, c]));

    // Load all enablers for matching
    const allEnablers = await db.select().from(enablers);

    if (isDryRun) {
        console.log('📊 Matching summary:');
        let matchCount = 0;
        let noMatchCount = 0;

        for (const entry of quizData) {
            const course = courseMap.get(entry.componentName);
            if (!course) {
                console.log(`   ❌ No course found: ${entry.componentName.substring(0, 50)}...`);
                noMatchCount++;
                continue;
            }

            const cleanTitle = cleanEnablerTitle(entry.enablerName);
            const enabler = allEnablers.find(e =>
                e.courseId === course.id && e.title === cleanTitle
            );

            if (!enabler) {
                console.log(`   ❌ No enabler found: ${cleanTitle.substring(0, 40)}...`);
                noMatchCount++;
            } else {
                matchCount++;
            }
        }

        console.log(`\n✅ ${matchCount} quizzes can be matched`);
        console.log(`❌ ${noMatchCount} quizzes cannot be matched`);
        console.log('\nRun without --dry-run to import.\n');
        process.exit(0);
    }

    const stats: ImportStats = {
        quizzesCreated: 0,
        questionsCreated: 0,
        optionsCreated: 0,
        linksCreated: 0,
        skipped: 0,
        errors: [],
    };

    console.log('🔄 Starting quiz import...\n');

    for (const entry of quizData) {
        // Skip entries with no questions
        if (!entry.questions || entry.questions.length === 0) {
            stats.skipped++;
            continue;
        }

        // Find course
        const course = courseMap.get(entry.componentName);
        if (!course) {
            stats.errors.push(`No course found: ${entry.componentName}`);
            continue;
        }

        // Find enabler
        const cleanTitle = cleanEnablerTitle(entry.enablerName);
        const enabler = allEnablers.find(e =>
            e.courseId === course.id && e.title === cleanTitle
        );

        if (!enabler) {
            stats.errors.push(`No enabler found: ${cleanTitle}`);
            continue;
        }

        process.stdout.write(`📝 ${cleanTitle.substring(0, 45)}... `);

        try {
            // Create quiz
            const [newQuiz] = await db.insert(quizzes).values({
                title: entry.quizTitle,
                quizType: 'LESSON',
                createdById: trainer.id,
                isActive: true,
            }).returning();

            stats.quizzesCreated++;

            // Create questions and options
            for (let qIdx = 0; qIdx < entry.questions.length; qIdx++) {
                const q = entry.questions[qIdx];

                const [newQuestion] = await db.insert(questions).values({
                    quizId: newQuiz.id,
                    questionText: q.questionText,
                    orderIndex: qIdx + 1,
                }).returning();

                stats.questionsCreated++;

                // Create 4 options
                for (let oIdx = 0; oIdx < q.options.length; oIdx++) {
                    await db.insert(options).values({
                        questionId: newQuestion.id,
                        optionText: q.options[oIdx],
                        isCorrect: oIdx === q.correctIndex,
                        orderIndex: oIdx + 1,
                    });

                    stats.optionsCreated++;
                }
            }

            // Link quiz to enabler
            await db.insert(enablerQuizzes).values({
                enablerId: enabler.id,
                quizId: newQuiz.id,
            });

            stats.linksCreated++;
            console.log('✅');

        } catch (error: any) {
            console.log(`❌ (${error.message})`);
            stats.errors.push(`Quiz for ${cleanTitle}: ${error.message}`);
        }
    }

    // Summary
    console.log('\n📊 Import Summary');
    console.log('=================');
    console.log(`   Quizzes created:   ${stats.quizzesCreated}`);
    console.log(`   Questions created: ${stats.questionsCreated}`);
    console.log(`   Options created:   ${stats.optionsCreated}`);
    console.log(`   Enabler links:     ${stats.linksCreated}`);
    console.log(`   Skipped (no Qs):   ${stats.skipped}`);

    if (stats.errors.length > 0) {
        console.log(`\n⚠️ Errors (${stats.errors.length}):`);
        stats.errors.slice(0, 10).forEach(e => console.log(`   - ${e}`));
        if (stats.errors.length > 10) {
            console.log(`   ... and ${stats.errors.length - 10} more`);
        }
    } else {
        console.log('\n✅ Quiz import completed successfully!');
    }

    process.exit(0);
}

main().catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
});
