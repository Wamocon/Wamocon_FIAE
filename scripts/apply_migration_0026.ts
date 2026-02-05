
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
    const migrationPath = path.resolve(__dirname, '../src/db/migrations/drizzle/0026_add_lernfelder_table.sql');

    try {
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSql.split(';').map(s => s.trim()).filter(s => s.length > 0);

        for (const stmt of statements) {
            if (stmt.startsWith('--')) continue;
            console.log('Running:', stmt);
            await sql.unsafe(stmt);
        }
        console.log('Migration 0026 applied.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await sql.end();
    }
}

main();
