
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
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
    const migrationPath = path.resolve(__dirname, '../src/db/migrations/drizzle/0025_add_use_case_fields.sql');

    try {
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSql.split(';').map(s => s.trim()).filter(s => s.length > 0);

        for (const stmt of statements) {
            if (stmt.startsWith('--')) continue;
            console.log('Running:', stmt);
            try {
                await sql.unsafe(stmt);
            } catch (e: any) {
                // If column exists, ignore
                if (e.code === '42701') {
                    console.log('Column already exists, skipping.');
                } else {
                    throw e; // rethrow other errors
                }
            }
        }
        console.log('Migration 0025 applied (idempotently).');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await sql.end();
    }
}

main();
