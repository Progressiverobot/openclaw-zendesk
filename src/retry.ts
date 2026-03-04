/**
 * Exponential backoff + jitter retry utility.
 *
 * Wraps any async operation and retries on transient failures
 * (network errors, 429 Too Many Requests, 503 Service Unavailable).
 *
 * Usage:
 *   const result = await withRetry(() => zendeskFetch(...), { maxAttempts: 4 });
 */

export interface RetryOptions {
  /** Maximum number of total attempts (including first). Default: 4 */
  maxAttempts?: number;
  /** Base delay in ms before first retry. Default: 500 */
  baseDelayMs?: number;
  /** Maximum delay cap in ms. Default: 30_000 */
  maxDelayMs?: number;
  /** Jitter fraction (0–1). Adds random(0..jitter*delay) to each wait. Default: 0.3 */
  jitter?: number;
  /** HTTP status codes that should trigger a retry. Default: [429, 503, 502, 504] */
  retryableStatusCodes?: number[];
  /** Optional logger */
  log?: (msg: string) => void;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: unknown,
  ) {
    super(message);
    this.name = "RetryError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calcDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, jitter: number): number {
  // Exponential backoff: base * 2^attempt
  const exp = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  const jitterMs = Math.random() * jitter * exp;
  return Math.round(exp + jitterMs);
}

export type RetryableResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/**
 * Retry any async function that returns a `{ ok, status? }` shaped result.
 * Retries when ok=false and the status code is in the retryable list (or on thrown errors).
 */
export async function withRetry<T>(
  fn: () => Promise<RetryableResult<T>>,
  opts: RetryOptions = {},
): Promise<RetryableResult<T>> {
  const {
    maxAttempts = 4,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    jitter = 0.3,
    retryableStatusCodes = [429, 502, 503, 504],
    log,
  } = opts;

  let lastResult: RetryableResult<T> | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn();

      if (result.ok) return result;

      // Check if retryable by status code
      if (!retryableStatusCodes.includes(result.status)) {
        // Non-retryable error (e.g. 404, 401, 422) – return immediately
        return result;
      }

      lastResult = result;
      log?.(
        `[zendesk] Retryable error (HTTP ${result.status}), attempt ${attempt + 1}/${maxAttempts}`,
      );
    } catch (err) {
      lastError = err;
      lastResult = undefined;
      log?.(
        `[zendesk] Network error on attempt ${attempt + 1}/${maxAttempts}: ${err}`,
      );
    }

    if (attempt < maxAttempts - 1) {
      const delay = calcDelay(attempt, baseDelayMs, maxDelayMs, jitter);
      log?.(`[zendesk] Waiting ${delay}ms before retry ${attempt + 2}/${maxAttempts}`);
      await sleep(delay);
    }
  }

  // All attempts exhausted
  if (lastResult) return lastResult;
  return {
    ok: false,
    status: 0,
    error: `All ${maxAttempts} attempts failed: ${lastError}`,
  };
}
