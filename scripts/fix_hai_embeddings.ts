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
        // Check if pgvector extension exists
        console.log('Checking pgvector extension...');
        const extResult = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;

        if (extResult.length === 0) {
            console.log('pgvector extension not found. Attempting to create...');
            try {
                await sql`CREATE EXTENSION IF NOT EXISTS vector`;
                console.log('pgvector extension created.');
            } catch (e: any) {
                console.error('Failed to create pgvector extension:', e.message);
                console.log('Note: You may need to enable pgvector in your Supabase dashboard.');
            }
        } else {
            console.log('pgvector extension is installed.');
        }

        // Check if hai_embeddings table exists
        console.log('\nChecking hai_embeddings table...');
        const tableResult = await sql`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'hai_embeddings'
            ORDER BY ordinal_position
        `;

        if (tableResult.length === 0) {
            console.log('hai_embeddings table does not exist. Creating...');
            await sql.unsafe(`
                CREATE TABLE IF NOT EXISTS hai_embeddings (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    source_type TEXT NOT NULL CHECK (source_type IN ('enabler', 'course', 'document', 'quiz')),
                    source_id UUID NOT NULL,
                    chunk_index INTEGER NOT NULL DEFAULT 0,
                    content TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    embedding vector(768),
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(source_type, source_id, chunk_index)
                )
            `);
            console.log('hai_embeddings table created.');
        } else {
            console.log('hai_embeddings table exists with columns:');
            tableResult.forEach(col => console.log(`  - ${col.column_name}: ${col.data_type}`));

            // Check if embedding column exists
            const hasEmbedding = tableResult.some(col => col.column_name === 'embedding');
            if (!hasEmbedding) {
                console.log('\nembedding column missing. Adding...');
                await sql.unsafe(`ALTER TABLE hai_embeddings ADD COLUMN embedding vector(768)`);
                console.log('embedding column added.');
            }
        }

        // Create indexes if they don't exist
        console.log('\nCreating indexes...');
        try {
            await sql.unsafe(`
                CREATE INDEX IF NOT EXISTS idx_hai_embeddings_source
                ON hai_embeddings(source_type, source_id)
            `);
            console.log('idx_hai_embeddings_source created.');
        } catch (e: any) {
            console.log('idx_hai_embeddings_source:', e.message);
        }

        try {
            await sql.unsafe(`
                CREATE INDEX IF NOT EXISTS idx_hai_embeddings_vector
                ON hai_embeddings USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 100)
            `);
            console.log('idx_hai_embeddings_vector created.');
        } catch (e: any) {
            // IVFFlat requires at least some data, HNSW doesn't
            console.log('IVFFlat index failed (might need data first):', e.message);
            console.log('Trying HNSW index instead...');
            try {
                await sql.unsafe(`
                    CREATE INDEX IF NOT EXISTS idx_hai_embeddings_vector
                    ON hai_embeddings USING hnsw (embedding vector_cosine_ops)
                `);
                console.log('HNSW index created.');
            } catch (e2: any) {
                console.log('HNSW index also failed:', e2.message);
            }
        }

        try {
            await sql.unsafe(`
                CREATE INDEX IF NOT EXISTS idx_hai_embeddings_hash
                ON hai_embeddings(content_hash)
            `);
            console.log('idx_hai_embeddings_hash created.');
        } catch (e: any) {
            console.log('idx_hai_embeddings_hash:', e.message);
        }

        console.log('\nDone!');
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await sql.end();
    }
}

main();
