
import postgres from 'postgres';
import * as fs from 'fs';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

dotenv.config({ path: '.env.local' });

interface Option {
    optionText: string;
    isCorrect: boolean;
    explanation?: string;
}

interface Question {
    questionText: string;
    options: (string | Option)[];
    correctIndex?: number;
}

interface QuizEntry {
    componentName: string;
    enablerName: string;
    quizTitle: string;
    questions: Question[];
}

async function main() {
    const connectionString = process.env.DB_CONNECTION_STRING;
    if (!connectionString) {
        console.error('DB_CONNECTION_STRING not found in .env.local');
        process.exit(1);
    }

    const filePath = process.argv[2] || 'quizzes_local_template.json';
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    const sql = postgres(connectionString);
    const rawData = fs.readFileSync(filePath, 'utf8');
    const data: QuizEntry[] = JSON.parse(rawData);

    console.log(`Starting import of ${data.length} enabler quiz entries...`);

    try {
        // 1. Get a trainer ID to own the quizzes
        const [trainer] = await sql`SELECT id FROM profiles WHERE role = 'TRAINER' LIMIT 1`;
        if (!trainer) {
            throw new Error('No trainer found in database to assign as creator.');
        }
        const trainerId = trainer.id;

        for (const entry of data) {
            console.log(`\nProcessing: ${entry.enablerName} (${entry.componentName})`);

            // 2. Find Enabler ID
            // We try to match by enabler name and part of the component name (since component names can have suffixes like "(§ 4 ...)")
            const cleanComponentName = entry.componentName.split('(')[0].trim();

            const [enabler] = await sql`
        SELECT e.id, e.title 
        FROM enablers e
        JOIN components c ON e.component_id = c.id
        WHERE e.title = ${entry.enablerName}
        AND c.title LIKE ${cleanComponentName + '%'}
        LIMIT 1
      `;

            if (!enabler) {
                console.warn(`⚠️  Enabler not found: "${entry.enablerName}" in component "${entry.componentName}". Skipping.`);
                continue;
            }

            // 3. Determine Difficulty
            let difficulty = 'MEDIUM';
            if (entry.quizTitle.includes('(HIGH)')) difficulty = 'HIGH';
            if (entry.quizTitle.includes('(LOW)')) difficulty = 'LOW';

            // 4. Upsert Quiz
            const [quiz] = await sql`
        INSERT INTO quizzes (id, title, quiz_type, is_active, created_by_id, created_at, updated_at)
        VALUES (
          ${uuidv4()}, 
          ${entry.quizTitle}, 
          'LOCAL', 
          true, 
          ${trainerId}, 
          NOW(), 
          NOW()
        )
        ON CONFLICT (title) DO UPDATE 
        SET updated_at = NOW(), is_active = true
        RETURNING id
      `;

            // 5. Link Enabler and Quiz
            await sql`
        INSERT INTO enabler_quiz_links (enabler_id, quiz_id, difficulty)
        VALUES (${enabler.id}, ${quiz.id}, ${difficulty})
        ON CONFLICT (enabler_id, quiz_id, difficulty) DO NOTHING
      `;

            console.log(`  ✅ Quiz "${entry.quizTitle}" linked to enabler.`);

            // 6. Process Questions
            let qIndex = 1;
            for (const qData of entry.questions) {
                // Upsert Question
                const [question] = await sql`
          INSERT INTO questions (id, quiz_id, question_text, question_type, order_index, created_at, updated_at)
          VALUES (
            ${uuidv4()}, 
            ${quiz.id}, 
            ${qData.questionText}, 
            'MCQ', 
            ${qIndex++}, 
            NOW(), 
            NOW()
          )
          ON CONFLICT (quiz_id, question_text) DO UPDATE
          SET order_index = EXCLUDED.order_index, updated_at = NOW()
          RETURNING id
        `;

                // Process Options
                // Strategy: Clear existing options for this question and re-insert to ensure sync
                await sql`DELETE FROM options WHERE question_id = ${question.id}`;

                for (let i = 0; i < qData.options.length; i++) {
                    const opt = qData.options[i];
                    let optionText = '';
                    let isCorrect = false;
                    let explanation = null;

                    if (typeof opt === 'string') {
                        optionText = opt;
                        isCorrect = i === qData.correctIndex;
                    } else {
                        optionText = opt.optionText;
                        isCorrect = opt.isCorrect;
                        explanation = opt.explanation || null;
                    }

                    await sql`
            INSERT INTO options (id, question_id, option_text, is_correct, explanation)
            VALUES (${uuidv4()}, ${question.id}, ${optionText}, ${isCorrect}, ${explanation})
          `;
                }
            }
            console.log(`  📊 Imported ${entry.questions.length} questions.`);
        }

        console.log('\n✨ Import completed successfully!');

    } catch (error) {
        console.error('\n❌ Import failed:', error);
    } finally {
        await sql.end();
    }
}

main();
