import { ZodError, type ZodTypeAny, type z } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'error',
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new AppError(400, msg, 'bad_request');
export const unauthorized = (msg = 'Not signed in') => new AppError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have permission to do this') => new AppError(403, msg, 'forbidden');
export const notFound = (what = 'Record') => new AppError(404, `${what} not found`, 'not_found');
export const conflict = (msg: string) => new AppError(409, msg, 'conflict');

/** Validates input against a zod schema, throwing a readable 400 on failure. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) throw new ValidationError(result.error);
  return result.data;
}

export class ValidationError extends AppError {
  constructor(public zodError: ZodError) {
    super(
      400,
      zodError.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; '),
      'validation',
    );
  }
}

/** Extracts a Postgres error code from driver errors (pg and PGlite), including wrapped causes. */
export function pgErrorCode(err: unknown): string | undefined {
  let e: any = err;
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    e = e.cause;
  }
  return undefined;
}
