
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/migrations/schemas/schema';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
    const connectionString = process.env.DB_CONNECTION_STRING;
    if (!connectionString) {
        console.error('DB_CONNECTION_STRING is not defined');
        process.exit(1);
    }

    const client = postgres(connectionString);
    const db = drizzle(client, { schema });

    try {
        console.log('Fetching quizzes...');
        const allQuizzes = await db.query.quizzes.findMany({
            with: {
                questions: {
                    with: {
                        options: true
                    }
                }
            }
        });

        console.log(`Found ${allQuizzes.length} quizzes.`);

        // Summary of quizzes
        allQuizzes.forEach(q => {
            console.log(`- Quiz: ${q.title} (ID: ${q.id}) - Questions: ${q.questions.length}`);
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

main();
