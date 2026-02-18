/**
 * HAI-specific Database Connection
 *
 * Provides a separate Drizzle instance that ALWAYS connects to the
 * production database, regardless of which environment the app runs in.
 *
 * This ensures HAI vector search, embeddings, and content indexing
 * always use production data — even when the app's main DB_CONNECTION_STRING
 * points to a QA/testing environment.
 *
 * Configuration:
 *   - Uses HAI_DB_CONNECTION_STRING if set (recommended)
 *   - Falls back to DB_CONNECTION_STRING if HAI_DB_CONNECTION_STRING is not set
 *
 * @module db/haiDb
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { Sql } from 'postgres';

// Ensure we don't create a new connection pool on every import (dev/hot-reload)
declare global {
  // eslint-disable-next-line no-var
  var __haiPgClient__: Sql | undefined;
  // eslint-disable-next-line no-var
  var __haiDrizzleDb__: ReturnType<typeof drizzle> | undefined;
}

function getHaiDb(): ReturnType<typeof drizzle> {
  if (globalThis.__haiDrizzleDb__) {
    return globalThis.__haiDrizzleDb__;
  }

  // Prefer HAI-specific connection string, fall back to main DB
  const connectionString =
    process.env.HAI_DB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;

  if (!connectionString) {
    throw new Error(
      'Neither HAI_DB_CONNECTION_STRING nor DB_CONNECTION_STRING is defined. ' +
        'HAI requires a database connection for vector search and embeddings.'
    );
  }

  const needsTls =
    /supabase\.(co|in)/i.test(connectionString) ||
    /sslmode=require/i.test(connectionString);

  const client =
    globalThis.__haiPgClient__ ||
    postgres(connectionString, {
      max: 10, // Smaller pool — HAI doesn't need as many connections
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 60 * 30,
      ssl: needsTls ? 'require' : undefined,
      prepare: false,
    });

  const db = drizzle(client);

  globalThis.__haiPgClient__ = client;
  globalThis.__haiDrizzleDb__ = db;

  return db;
}

// Export a proxy that lazily initializes the HAI database connection
const haiDb = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    return getHaiDb()[prop as keyof ReturnType<typeof drizzle>];
  },
});

export default haiDb;
