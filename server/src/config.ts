import 'dotenv/config';
import { z } from 'zod';

/** Docker Compose passes a removed variable as an empty string: treat that as not set. */
const blankAsUnset = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  /** PostgreSQL connection string. When absent (development only), an embedded PGlite database is used. */
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('./data/pglite'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ADMIN_USERNAME: z.preprocess(blankAsUnset, z.string().min(3).default('admin')),
  /** Only used the first time the server starts with an empty staff table. */
  ADMIN_PASSWORD: z.preprocess(blankAsUnset, z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters').optional()),
  /** Directory of the built web app (served by the API server). */
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production');
  }
  return parsed.data;
}
