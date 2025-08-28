import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/db/migrations/schemas/",           // Path to schema
  out: "./src/db/migrations/drizzle",     // Migrations folder
  dialect: "postgresql",                 
  dbCredentials: {
    url: process.env.DB_CONNECTION_STRING!, 
  },
});
