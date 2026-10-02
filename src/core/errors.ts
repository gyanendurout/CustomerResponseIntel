// Typed application errors. REST maps them to { error: { code, message, details } }; MCP to isError results.
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_BRAND'
  | 'UNSUPPORTED_COMBINATION'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'DB_TIMEOUT'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNKNOWN_BRAND: 400,
  UNSUPPORTED_COMBINATION: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  DB_TIMEOUT: 503,
};

export class AppError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}
