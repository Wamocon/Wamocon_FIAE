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

// Lazy initialization to avoid build-time errors when DB_CONNECTION_STRING is not set
function getDb(): ReturnType<typeof drizzle> {
  if (globalThis.__drizzleDb__) {
    return globalThis.__drizzleDb__;
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
      max: 10, // Keep under Supabase session-mode pool_size (usually 15)
      idle_timeout: 20, // Free idle connections quickly
      connect_timeout: 15, // Allow a bit more time for connection
      max_lifetime: 60 * 30, // 30 minutes max connection lifetime
      ssl: needsTls ? 'require' : undefined,
      prepare: false, // Required for PgBouncer pooler compatibility
    });

  const db = drizzle(client);

  // Cache in global for all environments to improve performance
  globalThis.__pgClient__ = client;
  globalThis.__drizzleDb__ = db;

  return db;
}

// Export a proxy that lazily initializes the database connection
const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof drizzle>];
  },
});

export default db;
