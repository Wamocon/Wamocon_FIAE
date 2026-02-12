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
        console.log('Adding metadata column to hai_chat_sessions...');
        await sql.unsafe(`
            ALTER TABLE hai_chat_sessions
            ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb
        `);
        console.log('Migration applied successfully.');
    } catch (err: any) {
        if (err.code === '42701') {
            console.log('Column already exists, skipping.');
        } else {
            console.error('Migration failed:', err);
        }
    } finally {
        await sql.end();
    }
}

main();
