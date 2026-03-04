/**
 * Shared Zendesk API primitives: authenticated fetch, rate-limit tracking,
 * TTL response caching, and in-flight request deduplication.
 * All API modules import from here.
 *
 * Built by Progressive Robot Ltd
 * https://www.progressiverobot.com
 */

import { withRetry } from "../retry.js";
import { zdApiCache, zdInflight } from "../cache.js";

export function buildBaseUrl(subdomain: string): string {
  return `https://${subdomain}.zendesk.com/api/v2`;
}

export function buildHelpCenterUrl(subdomain: string, locale = "en-us"): string {
  return `https://${subdomain}.zendesk.com/api/v2/help_center/${locale}`;
}

export function buildAuthHeader(agentEmail: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${agentEmail}/token:${apiToken}`).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Rate-limit tracking
// ---------------------------------------------------------------------------

interface RateLimitState {
  remaining: number;
  resetAt: number; // Unix ms
}

const rateLimitState = new Map<string, RateLimitState>();

function updateRateLimit(subdomain: string, headers: Headers): void {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining !== null && reset !== null) {
    rateLimitState.set(subdomain, {
      remaining: parseInt(remaining, 10),
      resetAt: parseInt(reset, 10) * 1000,
    });
  }
}

async function waitForRateLimit(subdomain: string): Promise<void> {
  const state = rateLimitState.get(subdomain);
  if (!state || state.remaining > 0) return;
  // Only sleep if the reset timestamp is still in the future
  const waitMs = state.resetAt - Date.now();
  if (waitMs > 0 && waitMs < 120_000) {
    await new Promise<void>((r) => setTimeout(r, waitMs + 100));
  }
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

export type ZdResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export async function zdFetch<T>(
  url: string,
  agentEmail: string,
  apiToken: string,
  options: RequestInit = {},
): Promise<ZdResult<T>> {
  const subdomainMatch = url.match(/https:\/\/([^.]+)\.zendesk\.com/);
  const subdomain = subdomainMatch?.[1] ?? "";

  await waitForRateLimit(subdomain);

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: buildAuthHeader(agentEmail, apiToken),
    ...(options.headers as Record<string, string> | undefined),
  };

  // Don't force Content-Type for multipart/form-data; browser sets it with boundary
  if (!headers["Content-Type"] && options.method && options.method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, { ...options, headers });

  if (subdomain) updateRateLimit(subdomain, res.headers);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: body || `Zendesk API error: HTTP ${res.status}`,
    };
  }

  // 204 No Content
  if (res.status === 204) {
    return { ok: true, data: null as T };
  }

  const data = (await res.json()) as T;
  return { ok: true, data };
}

/** zdFetch wrapped with automatic retry on transient errors (429, 5xx). */
export async function zdFetchRetry<T>(
  url: string,
  agentEmail: string,
  apiToken: string,
  options: RequestInit = {},
): Promise<ZdResult<T>> {
  return withRetry(() => zdFetch<T>(url, agentEmail, apiToken, options));
}

/**
 * GET-only fetch with TTL response cache + in-flight deduplication.
 * Concurrent requests for the same URL collapse into a single network call.
 * @param ttlMs - How long to cache the response (default 30 s). Pass 0 to bypass.
 */
export async function zdFetchCached<T>(
  url: string,
  agentEmail: string,
  apiToken: string,
  ttlMs = 30_000,
): Promise<ZdResult<T>> {
  if (ttlMs === 0) return zdFetchRetry<T>(url, agentEmail, apiToken);
  const cacheKey = `${agentEmail}::${url}`;
  const cached = zdApiCache.get(cacheKey) as ZdResult<T> | undefined;
  if (cached !== undefined) return cached;
  const result = (await zdInflight.get(cacheKey, () =>
    zdFetchRetry<T>(url, agentEmail, apiToken),
  )) as ZdResult<T>;
  if (result.ok) zdApiCache.set(cacheKey, result, ttlMs);
  return result;
}

/**
 * Invalidate all cache entries whose key contains urlPrefix.
 * Call after any POST / PUT / PATCH / DELETE that mutates a resource.
 * e.g. invalidateCacheFor("/tickets/123") clears both the ticket and its comments.
 */
export function invalidateCacheFor(urlPrefix: string): void {
  zdApiCache.invalidateWhere((key: string) => key.includes(urlPrefix));
}

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface OffsetPage<T> {
  items: T[];
  count: number;
  nextPage: string | null;
}

/** Build a URLSearchParams string for cursor-based pagination. */
export function cursorParams(pageSize: number, afterCursor?: string): string {
  const p = new URLSearchParams({ "page[size]": String(Math.min(pageSize, 100)) });
  if (afterCursor) p.set("page[after]", afterCursor);
  return p.toString();
}

/** Generic error result builder. */
export function errResult(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}
