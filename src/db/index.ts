import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import 'dotenv/config';

if (!process.env.DB_CONNECTION_STRING) {
  throw new Error(
    'DB_CONNECTION_STRING is not defined in the environment variables'
  );
}
const client = postgres(process.env.DB_CONNECTION_STRING);
const db = drizzle(client);

export default db;
