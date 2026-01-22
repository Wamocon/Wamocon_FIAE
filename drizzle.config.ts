import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

export default defineConfig({
  schema: './src/db/migrations/schemas/', // Path to schema
  out: './src/db/migrations/drizzle', // Migrations folder
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DB_CONNECTION_STRING!,
  },
});
