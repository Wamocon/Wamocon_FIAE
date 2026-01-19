
import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
    const connectionString = process.env.DB_CONNECTION_STRING;
    if (!connectionString) {
        console.error('DB_CONNECTION_STRING missing');
        process.exit(1);
    }

    const sql = postgres(connectionString, { ssl: 'require', max: 1 });

    try {
        console.log('Dropping table lernfelder...');
        await sql`DROP TABLE IF EXISTS "lernfelder" CASCADE`;

        console.log('Creating table lernfelder...');
        await sql`
      CREATE TABLE "lernfelder" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" text NOT NULL,
        "description" text,
        "label" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp
      )
    `;
        console.log('Lernfelder table recreated successfully.');
    } catch (err) {
        console.error('Fix failed:', err);
    } finally {
        await sql.end();
    }
}

main();
