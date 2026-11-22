import { defineConfig } from 'drizzle-kit';

// Generates versioned SQL migrations into ./drizzle from the schema.
// Migrations are applied automatically when the server starts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
