export type ErrorCode =
  | 'NOT_FOUND'
  | 'FLOOD_WAIT'
  | 'FORBIDDEN'
  | 'AUTH_REQUIRED'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/// The one error type that crosses module boundaries. MCP tools turn it into
/// a readable `CODE: message` for Claude, so messages must never contain
/// message text, phone numbers or secrets.
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
