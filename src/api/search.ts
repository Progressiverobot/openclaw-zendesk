/**
 * Zendesk Unified Search API.
 * https://developer.zendesk.com/api-reference/ticketing/ticket-management/search/
 */

import { buildBaseUrl, zdFetchRetry } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type Err = { ok: false; status: number; error: string };

export interface SearchResults<T = unknown> {
  results: T[];
  count: number;
  nextPage: string | null;
  previousPage: string | null;
}

/**
 * Search across all Zendesk resources using the unified search API.
 *
 * Query syntax: https://developer.zendesk.com/documentation/ticketing/using-the-zendesk-api/searching-with-the-zendesk-api/
 *
 * Examples:
 *   "type:ticket status:open priority:urgent"
 *   "type:user email:foo@bar.com"
 *   "type:ticket subject:refund created>2024-01-01"
 */
export async function search<T = unknown>(
  c: Creds,
  query: string,
  opts: { page?: number; perPage?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {},
): Promise<{ ok: true } & SearchResults<T> | Err> {
  const p = new URLSearchParams({ query });
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  if (opts.sortBy) p.set("sort_by", opts.sortBy);
  if (opts.sortOrder) p.set("sort_order", opts.sortOrder);
  const url = `${buildBaseUrl(c.subdomain)}/search.json?${p}`;
  const r = await zdFetchRetry<{
    results: T[];
    count: number;
    next_page: string | null;
    previous_page: string | null;
  }>(url, c.agentEmail, c.apiToken);
  return r.ok
    ? {
        ok: true,
        results: r.data.results,
        count: r.data.count,
        nextPage: r.data.next_page,
        previousPage: r.data.previous_page,
      }
    : r;
}

/** Convenience: search for tickets only. */
export async function searchTickets(
  c: Creds,
  query: string,
  opts: { page?: number; perPage?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {},
) {
  return search(c, `type:ticket ${query}`, opts);
}

/** Convenience: search for users only. */
export async function searchUsers(
  c: Creds,
  query: string,
  opts: { page?: number; perPage?: number } = {},
) {
  return search(c, `type:user ${query}`, opts);
}

/** Convenience: search for organizations only. */
export async function searchOrgs(
  c: Creds,
  query: string,
  opts: { page?: number; perPage?: number } = {},
) {
  return search(c, `type:organization ${query}`, opts);
}

/** Export search (returns all results, multiple pages). */
export async function searchExport<T = unknown>(
  c: Creds,
  query: string,
  maxResults = 200,
): Promise<{ ok: true; results: T[] } | Err> {
  const all: T[] = [];
  let page = 1;
  while (all.length < maxResults) {
    const perPage = Math.min(100, maxResults - all.length);
    const r = await search<T>(c, query, { page, perPage });
    if (!r.ok) return r;
    all.push(...r.results);
    if (!r.nextPage || r.results.length === 0) break;
    page++;
  }
  return { ok: true, results: all };
}
