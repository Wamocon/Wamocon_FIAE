import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { Sql } from 'postgres';
import 'dotenv/config';

// Ensure we don't create a new connection pool on every import (dev/hot-reload, API routes)
declare global {
  // eslint-disable-next-line no-var
  var __pgClient__: Sql | undefined;
  // eslint-disable-next-line no-var
  var __drizzleDb__: ReturnType<typeof drizzle> | undefined;
}

if (!process.env.DB_CONNECTION_STRING) {
  throw new Error(
    'DB_CONNECTION_STRING is not defined in the environment variables'
  );
}

// Tune pool size to avoid exhausting local Postgres connection limits.
// postgres-js creates connections lazily; max is the upper bound.
const needsTls =
  /supabase\.(co|in)/i.test(process.env.DB_CONNECTION_STRING) ||
  /sslmode=require/i.test(process.env.DB_CONNECTION_STRING);

const client =
  globalThis.__pgClient__ ||
  postgres(process.env.DB_CONNECTION_STRING, {
    max: 5, // keep small for local/dev; adjust if needed
    idle_timeout: 30, // seconds before idle connections are closed
    ssl: needsTls ? 'require' : undefined,
  });

const db = globalThis.__drizzleDb__ || drizzle(client);

// Cache in global in dev/non-serverless to survive HMR and route re-imports
if (process.env.NODE_ENV !== 'production') {
  globalThis.__pgClient__ = client;
  globalThis.__drizzleDb__ = db;
}

export default db;
