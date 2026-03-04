/**
 * Shared caching primitives for the Zendesk module.
 *
 *  - TtlCache        : simple TTL-keyed value store with automatic expiry pruning
 *  - InflightCache   : deduplicates concurrent requests for the same key so only
 *                      one real fetch is made, all callers share the result
 *  - debounceCache   : wraps an async function so repeated calls with the same
 *                      serialised arguments within `windowMs` return a cached result
 *
 * Singletons `zdApiCache` and `zdInflight` are used by src/api/base.ts.
 *
 * Built by Progressive Robot Ltd
 * https://www.progressiverobot.com
 */

// ---------------------------------------------------------------------------
// TTL Cache
// ---------------------------------------------------------------------------

interface TtlEntry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private readonly store = new Map<K, TtlEntry<V>>();

  constructor(
    /** Default TTL in milliseconds (can be overridden per set() call). */
    private readonly defaultTtlMs: number = 30_000,
    /** How often to run automatic prune (ms). 0 = manual only. */
    pruneIntervalMs: number = 60_000,
  ) {
    if (pruneIntervalMs > 0) {
      // Use unref() so the timer never keeps a Node process alive
      const timer = setInterval(() => this.prune(), pruneIntervalMs);
      if (typeof timer === "object" && "unref" in timer) {
        (timer as NodeJS.Timeout).unref();
      }
    }
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  /** Delete all entries whose key matches the predicate (prefix invalidation). */
  invalidateWhere(predicate: (key: K) => boolean): void {
    for (const key of this.store.keys()) {
      if (predicate(key)) this.store.delete(key);
    }
  }

  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  size(): number {
    this.prune();
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// In-flight deduplication cache
// ---------------------------------------------------------------------------

/**
 * Ensures that concurrent calls with the same key share one underlying
 * Promise rather than spawning duplicate network requests.
 */
export class InflightCache<K, V> {
  private readonly inflight = new Map<K, Promise<V>>();

  /**
   * Return an existing in-flight Promise if one exists for `key`, otherwise
   * execute `fn`, store its Promise, and clean up when it settles.
   */
  async get(key: K, fn: () => Promise<V>): Promise<V> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  size(): number {
    return this.inflight.size;
  }
}

// ---------------------------------------------------------------------------
// Debounce cache (for agent tool calls)
// ---------------------------------------------------------------------------

/**
 * Wraps an async function so that repeated calls with the same arguments
 * within `windowMs` return the cached result instead of re-executing.
 *
 * Unlike a simple TTL cache, the window resets on each call (leading-edge
 * debounce: the first call executes, subsequent identical calls within
 * `windowMs` are served the same result).
 *
 * @param fn        The async function to wrap.
 * @param windowMs  Debounce window in milliseconds (default 2 000).
 * @param keyFn     Optional custom key serialiser (default JSON.stringify).
 */
export function debounceCache<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  windowMs: number = 2_000,
  keyFn: (...args: TArgs) => string = (...args) => JSON.stringify(args),
): (...args: TArgs) => Promise<TReturn> {
  const cache = new TtlCache<string, TReturn>(windowMs, 0);

  return async (...args: TArgs): Promise<TReturn> => {
    const key = keyFn(...args);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const result = await fn(...args);
    cache.set(key, result, windowMs);
    return result;
  };
}

// ---------------------------------------------------------------------------
// Module-level singletons used by src/api/base.ts
// ---------------------------------------------------------------------------

/**
 * Response cache for successful Zendesk GET API responses.
 * Default TTL: 30 s. Individual API modules may override per call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const zdApiCache = new TtlCache<string, any>(30_000, 60_000);

/**
 * In-flight deduplication – prevents concurrent duplicate fetches to the
 * same URL while the first request is still in-flight.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const zdInflight = new InflightCache<string, any>();
