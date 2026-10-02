// Maps any thrown value to a safe client-facing error. Internal details go to the log, never to the client.
import { ZodError } from 'zod';
import { AppError, type ErrorCode } from '@/core/errors';
import { DbTimeoutError } from '@/core/db';
import { log } from './log';

export interface ErrorBody { error: { code: ErrorCode; message: string; details: unknown } }

export function toError(err: unknown, context: Record<string, unknown> = {}): { status: number; body: ErrorBody } {
  if (err instanceof ZodError) {
    const details = err.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
    const message = 'Invalid input: ' + details.map(d => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ');
    return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message, details } } };
  }
  if (err instanceof AppError) return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details ?? null } } };
  if (err instanceof DbTimeoutError) return { status: 503, body: { error: { code: 'DB_TIMEOUT', message: err.message, details: null } } };
  log('error', 'unhandled_error', { ...context, name: (err as Error)?.name, message: (err as Error)?.message, stack: (err as Error)?.stack?.split('\n').slice(0, 5).join(' | ') });
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on our side. It has been logged.', details: null } } };
}
