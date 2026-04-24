import type { ErrorKind } from './types';

/**
 * Thrown by a step handler when the failure is recoverable. The engine will
 * retry with exponential backoff up to the step's maxAttempts.
 */
export class TransientError extends Error {
  readonly kind: ErrorKind = 'transient';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'TransientError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Thrown by a step handler when the failure cannot be recovered. The engine
 * stops the workflow and records the failure.
 */
export class FatalError extends Error {
  readonly kind: ErrorKind = 'fatal';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'FatalError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function classifyError(err: unknown): ErrorKind {
  if (err instanceof FatalError) return 'fatal';
  if (err instanceof TransientError) return 'transient';
  // Unknown errors are treated as transient by default so the engine retries
  // once or twice before giving up. Handlers that know better should throw
  // FatalError explicitly.
  return 'transient';
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
