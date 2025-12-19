/**
 * Global Quiz Import Script (Component/Course Quizzes)
 * 
 * Imports global quizzes that cover entire components/courses.
 * These are type: GLOBAL quizzes.
 * 
 * Usage: npx tsx -r dotenv/config scripts/import-quizzes-global.ts
 * 
 * Dry run: npx tsx -r dotenv/config scripts/import-quizzes-global.ts --dry-run
 */

import 'dotenv/config';
import db from '../src/db';
import {
    courses,
    quizzes,
    questions,
    options,
    profiles
} from '../src/db/migrations/schemas/schema';
import * as fs from 'fs';
import * as path from 'path';
import { eq } from 'drizzle-orm';

interface QuizQuestion {
    questionText: string;
    options: string[]; // Array of 4 options
    correctIndex: number; // 0-3
}

interface GlobalQuizEntry {
    componentName: string;
    quizTitle: string;
    questions: QuizQuestion[];
}

interface ImportStats {
    quizzesCreated: number;
    questionsCreated: number;
    optionsCreated: number;
    skipped: number;
    errors: string[];
}

async function main() {
    const isDryRun = process.argv.includes('--dry-run');

    console.log('📥 Global Quiz Import Script (Component Quizzes)');
    console.log('================================================\n');

    if (isDryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    // Load quiz data
    const quizPath = path.join(__dirname, '..', 'quizzes_global.json');

    if (!fs.existsSync(quizPath)) {
        console.log('⚠️ quizzes_global.json not found.');
        console.log('   Please fill in the quiz data in quizzes_global_template.json');
        console.log('   and rename it to quizzes_global.json\n');

        const templatePath = path.join(__dirname, '..', 'quizzes_global_template.json');
        if (fs.existsSync(templatePath)) {
            console.log('   Template file exists: quizzes_global_template.json');
        }
        process.exit(1);
    }

    const quizData: GlobalQuizEntry[] = JSON.parse(fs.readFileSync(quizPath, 'utf-8'));
    console.log(`📊 Loaded ${quizData.length} global quiz entries\n`);

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

    if (isDryRun) {
        console.log('📊 Matching summary:');
        let matchCount = 0;
        let noMatchCount = 0;

        for (const entry of quizData) {
            const course = courseMap.get(entry.componentName);
            if (!course) {
                console.log(`   ❌ No course found: ${entry.componentName.substring(0, 50)}...`);
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
        skipped: 0,
        errors: [],
    };

    console.log('🔄 Starting global quiz import...\n');

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

        process.stdout.write(`📚 ${entry.quizTitle.substring(0, 50)}... `);

        try {
            // Create global quiz
            const [newQuiz] = await db.insert(quizzes).values({
                title: entry.quizTitle,
                quizType: 'GLOBAL',
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

            console.log('✅');

        } catch (error: any) {
            console.log(`❌ (${error.message})`);
            stats.errors.push(`Quiz ${entry.quizTitle}: ${error.message}`);
        }
    }

    // Summary
    console.log('\n📊 Import Summary');
    console.log('=================');
    console.log(`   Global quizzes:    ${stats.quizzesCreated}`);
    console.log(`   Questions created: ${stats.questionsCreated}`);
    console.log(`   Options created:   ${stats.optionsCreated}`);
    console.log(`   Skipped (no Qs):   ${stats.skipped}`);

    if (stats.errors.length > 0) {
        console.log(`\n⚠️ Errors (${stats.errors.length}):`);
        stats.errors.slice(0, 10).forEach(e => console.log(`   - ${e}`));
        if (stats.errors.length > 10) {
            console.log(`   ... and ${stats.errors.length - 10} more`);
        }
    } else {
        console.log('\n✅ Global quiz import completed successfully!');
    }

    console.log('\n📝 Note: Global quizzes need to be assigned to trainees via quiz_assignments.');
    console.log('   This can be done through the trainer UI or by adding assignees manually.');

    process.exit(0);
}

main().catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
});
