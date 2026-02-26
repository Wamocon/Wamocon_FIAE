
import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
    const connectionString = process.env.DB_CONNECTION_STRING;
    if (!connectionString) {
        console.error('DB_CONNECTION_STRING not found');
        return;
    }

    const sql = postgres(connectionString);

    try {
        console.log('--- Database Stats ---');

        const enablersCount = await sql`SELECT count(*) FROM enablers`;
        console.log(`Enablers: ${enablersCount[0].count}`);

        const quizzesCount = await sql`SELECT count(*) FROM quizzes`;
        console.log(`Quizzes: ${quizzesCount[0].count}`);

        const linksCount = await sql`SELECT count(*) FROM enabler_quiz_links`;
        console.log(`Enabler Quiz Links: ${linksCount[0].count}`);

        const questionsCount = await sql`SELECT count(*) FROM questions`;
        console.log(`Questions: ${questionsCount[0].count}`);

        console.log('\n--- Sample Enabler Quiz Links ---');
        const samples = await sql`
      SELECT e.id as enabler_id, e.title as enabler_title, q.title as quiz_title, l.difficulty
      FROM enabler_quiz_links l
      JOIN enablers e ON l.enabler_id = e.id
      JOIN quizzes q ON l.quiz_id = q.id
      LIMIT 10
    `;
        console.table(samples);

        console.log('\n--- Specific Enabler Check (4cc0c88e-4846-4480-9475-2c887dba906d) ---');
        const specificEnabler = await sql`
          SELECT id, title FROM enablers WHERE id = '4cc0c88e-4846-4480-9475-2c887dba906d'
        `;
        console.log('Enabler:', specificEnabler);

        const specificLinks = await sql`
          SELECT l.difficulty, q.title as quiz_title, l.quiz_id
          FROM enabler_quiz_links l
          JOIN quizzes q ON l.quiz_id = q.id
          WHERE l.enabler_id = '4cc0c88e-4846-4480-9475-2c887dba906d'
        `;
        console.log('Linked Quizzes:', specificLinks);

    } catch (error) {
        console.error('Error querying DB:', error);
    } finally {
        await sql.end();
    }
}

main();
