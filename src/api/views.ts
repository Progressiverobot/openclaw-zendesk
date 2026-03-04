/**
 * Zendesk Views API – list, execute (fetch tickets), CRUD, preview.
 * https://developer.zendesk.com/api-reference/ticketing/business-rules/views/
 */

import type { ZendeskView, ZendeskTicket } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type OkView = { ok: true; view: ZendeskView };
type OkViews = { ok: true; views: ZendeskView[] };
type Err = { ok: false; status: number; error: string };

export async function getView(c: Creds, viewId: string | number): Promise<OkView | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/views/${viewId}.json`;
  const r = await zdFetchRetry<{ view: ZendeskView }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, view: r.data.view } : r;
}

export async function listViews(c: Creds, active = true): Promise<OkViews | Err> {
  const p = new URLSearchParams({ active: String(active) });
  const url = `${buildBaseUrl(c.subdomain)}/views.json?${p}`;
  const r = await zdFetchRetry<{ views: ZendeskView[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, views: r.data.views } : r;
}

export async function listActiveViews(c: Creds): Promise<OkViews | Err> {
  return listViews(c, true);
}

/** Execute a view: returns the tickets currently matching it. */
export async function executeView(
  c: Creds,
  viewId: string | number,
  opts: { page?: number; perPage?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {},
): Promise<{ ok: true; tickets: ZendeskTicket[]; count: number; nextPage: string | null } | Err> {
  const p = new URLSearchParams();
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  if (opts.sortBy) p.set("sort_by", opts.sortBy);
  if (opts.sortOrder) p.set("sort_order", opts.sortOrder);
  const url = `${buildBaseUrl(c.subdomain)}/views/${viewId}/tickets.json?${p}`;
  const r = await zdFetchRetry<{ tickets: ZendeskTicket[]; count: number; next_page: string | null }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok
    ? { ok: true, tickets: r.data.tickets, count: r.data.count, nextPage: r.data.next_page }
    : r;
}

/** Get ticket count for a view without fetching all tickets. */
export async function countViewTickets(
  c: Creds,
  viewId: string | number,
): Promise<{ ok: true; count: number; fresh: boolean } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/views/${viewId}/count.json`;
  const r = await zdFetchRetry<{ view_count: { value: number; fresh: boolean } }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok ? { ok: true, count: r.data.view_count.value, fresh: r.data.view_count.fresh } : r;
}

export async function createView(
  c: Creds,
  fields: {
    title: string;
    active?: boolean;
    conditions?: ZendeskView["conditions"];
    output?: Record<string, unknown>;
  },
): Promise<OkView | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/views.json`;
  const r = await zdFetchRetry<{ view: ZendeskView }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ view: fields }),
  });
  return r.ok ? { ok: true, view: r.data.view } : r;
}

export async function updateView(
  c: Creds,
  viewId: string | number,
  updates: { title?: string; active?: boolean; conditions?: ZendeskView["conditions"] },
): Promise<OkView | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/views/${viewId}.json`;
  const r = await zdFetchRetry<{ view: ZendeskView }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ view: updates }),
  });
  return r.ok ? { ok: true, view: r.data.view } : r;
}

export async function deleteView(c: Creds, viewId: string | number): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/views/${viewId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}
