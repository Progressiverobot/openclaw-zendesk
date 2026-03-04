/**
 * Zendesk Tickets API – full CRUD, bulk operations, merge, skip, satisfaction.
 * https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/
 */

import type {
  ZendeskTicket,
  ZendeskSatisfactionRating,
  ZendeskTicketMetric,
} from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type OkTicket = { ok: true; ticket: ZendeskTicket };
type OkTickets = { ok: true; tickets: ZendeskTicket[]; count: number; nextPage: string | null };
type Err = { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// Fetch / list
// ---------------------------------------------------------------------------

export async function getTicket(c: Creds, ticketId: string | number): Promise<OkTicket | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}.json`;
  const r = await zdFetchRetry<{ ticket: ZendeskTicket }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, ticket: r.data.ticket } : r;
}

export async function getTickets(c: Creds, ids: (string | number)[]): Promise<OkTickets | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/show_many.json?ids=${ids.join(",")}`;
  const r = await zdFetchRetry<{ tickets: ZendeskTicket[]; count: number; next_page: string | null }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok
    ? { ok: true, tickets: r.data.tickets, count: r.data.count, nextPage: r.data.next_page }
    : r;
}

export async function listTickets(
  c: Creds,
  opts: { page?: number; perPage?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {},
): Promise<OkTickets | Err> {
  const p = new URLSearchParams();
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  if (opts.sortBy) p.set("sort_by", opts.sortBy);
  if (opts.sortOrder) p.set("sort_order", opts.sortOrder);
  const url = `${buildBaseUrl(c.subdomain)}/tickets.json?${p}`;
  const r = await zdFetchRetry<{ tickets: ZendeskTicket[]; count: number; next_page: string | null }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok
    ? { ok: true, tickets: r.data.tickets, count: r.data.count, nextPage: r.data.next_page }
    : r;
}

export async function listTicketsByRequester(
  c: Creds,
  requesterId: string | number,
  opts: { page?: number; perPage?: number } = {},
): Promise<OkTickets | Err> {
  const p = new URLSearchParams({ requester_id: String(requesterId) });
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(opts.perPage));
  const url = `${buildBaseUrl(c.subdomain)}/tickets.json?${p}`;
  const r = await zdFetchRetry<{ tickets: ZendeskTicket[]; count: number; next_page: string | null }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok
    ? { ok: true, tickets: r.data.tickets, count: r.data.count, nextPage: r.data.next_page }
    : r;
}

export async function listTicketsByOrg(
  c: Creds,
  orgId: string | number,
  opts: { page?: number; perPage?: number } = {},
): Promise<OkTickets | Err> {
  const p = new URLSearchParams();
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(opts.perPage));
  const url = `${buildBaseUrl(c.subdomain)}/organizations/${orgId}/tickets.json?${p}`;
  const r = await zdFetchRetry<{ tickets: ZendeskTicket[]; count: number; next_page: string | null }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok
    ? { ok: true, tickets: r.data.tickets, count: r.data.count, nextPage: r.data.next_page }
    : r;
}

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

export async function createTicket(
  c: Creds,
  fields: {
    subject: string;
    comment: { body: string; public?: boolean };
    requester?: { name?: string; email?: string };
    assignee_id?: number;
    group_id?: number;
    status?: string;
    priority?: string;
    type?: string;
    tags?: string[];
    custom_fields?: Array<{ id: number; value: unknown }>;
  },
): Promise<OkTicket | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets.json`;
  const r = await zdFetchRetry<{ ticket: ZendeskTicket }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ ticket: fields }),
  });
  return r.ok ? { ok: true, ticket: r.data.ticket } : r;
}

export async function updateTicket(
  c: Creds,
  ticketId: string | number,
  updates: {
    status?: "open" | "pending" | "solved" | "closed" | "hold";
    priority?: "low" | "normal" | "high" | "urgent";
    type?: "problem" | "incident" | "question" | "task";
    subject?: string;
    tags?: string[];
    assignee_id?: number | null;
    group_id?: number | null;
    custom_fields?: Array<{ id: number; value: unknown }>;
    comment?: { body: string; public?: boolean };
  },
): Promise<OkTicket | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}.json`;
  const r = await zdFetchRetry<{ ticket: ZendeskTicket }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ ticket: updates }),
  });
  return r.ok ? { ok: true, ticket: r.data.ticket } : r;
}

/** Bulk-update up to 100 tickets at once. */
export async function bulkUpdateTickets(
  c: Creds,
  ids: (string | number)[],
  updates: {
    status?: string;
    priority?: string;
    assignee_id?: number | null;
    group_id?: number | null;
    tags?: string[];
  },
): Promise<{ ok: true; jobStatus: unknown } | Err> {
  const p = new URLSearchParams({ ids: ids.join(",") });
  const url = `${buildBaseUrl(c.subdomain)}/tickets/update_many.json?${p}`;
  const r = await zdFetchRetry<{ job_status: unknown }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ ticket: updates }),
  });
  return r.ok ? { ok: true, jobStatus: r.data.job_status } : r;
}

/** Soft-delete a ticket (moves to deleted view). */
export async function deleteTicket(c: Creds, ticketId: string | number): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}

/** Bulk delete tickets. */
export async function bulkDeleteTickets(
  c: Creds,
  ids: (string | number)[],
): Promise<{ ok: true; jobStatus: unknown } | Err> {
  const p = new URLSearchParams({ ids: ids.join(",") });
  const url = `${buildBaseUrl(c.subdomain)}/tickets/destroy_many.json?${p}`;
  const r = await zdFetch<{ job_status: unknown }>(url, c.agentEmail, c.apiToken, {
    method: "DELETE",
  });
  return r.ok ? { ok: true, jobStatus: r.data.job_status } : r;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Merge source tickets into a target ticket. */
export async function mergeTickets(
  c: Creds,
  targetId: string | number,
  sourceIds: (string | number)[],
  opts: { targetComment?: string; sourceComment?: string } = {},
): Promise<{ ok: true; jobStatus: unknown } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${targetId}/merge.json`;
  const body: Record<string, unknown> = { ids: sourceIds };
  if (opts.targetComment) body["target_comment"] = opts.targetComment;
  if (opts.sourceComment) body["source_comment"] = opts.sourceComment;
  const r = await zdFetchRetry<{ job_status: unknown }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return r.ok ? { ok: true, jobStatus: r.data.job_status } : r;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function getTicketTags(c: Creds, ticketId: string | number): Promise<{ ok: true; tags: string[] } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}/tags.json`;
  const r = await zdFetchRetry<{ tags: string[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, tags: r.data.tags } : r;
}

export async function setTicketTags(
  c: Creds,
  ticketId: string | number,
  tags: string[],
): Promise<{ ok: true; tags: string[] } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}/tags.json`;
  const r = await zdFetchRetry<{ tags: string[] }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
  return r.ok ? { ok: true, tags: r.data.tags } : r;
}

export async function addTicketTags(
  c: Creds,
  ticketId: string | number,
  tags: string[],
): Promise<{ ok: true; tags: string[] } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}/tags.json`;
  const r = await zdFetchRetry<{ tags: string[] }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ tags }),
  });
  return r.ok ? { ok: true, tags: r.data.tags } : r;
}

export async function removeTicketTags(
  c: Creds,
  ticketId: string | number,
  tags: string[],
): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}/tags.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, {
    method: "DELETE",
    body: JSON.stringify({ tags }),
  });
  return r.ok ? { ok: true } : r;
}

// ---------------------------------------------------------------------------
// Satisfaction
// ---------------------------------------------------------------------------

export async function getTicketSatisfactionRating(
  c: Creds,
  ticketId: string | number,
): Promise<{ ok: true; rating: ZendeskSatisfactionRating } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}/satisfaction_rating.json`;
  const r = await zdFetchRetry<{ satisfaction_rating: ZendeskSatisfactionRating }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok ? { ok: true, rating: r.data.satisfaction_rating } : r;
}

// ---------------------------------------------------------------------------
// Ticket metrics
// ---------------------------------------------------------------------------

export async function getTicketMetrics(
  c: Creds,
  ticketId: string | number,
): Promise<{ ok: true; metric: ZendeskTicketMetric } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}/metrics.json`;
  const r = await zdFetchRetry<{ ticket_metric: ZendeskTicketMetric }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, metric: r.data.ticket_metric } : r;
}

// ---------------------------------------------------------------------------
// Skips (for round-robin agent skip tracking)
// ---------------------------------------------------------------------------

export async function skipTicket(
  c: Creds,
  ticketId: string | number,
  reason?: string,
): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/skips.json`;
  const r = await zdFetchRetry<unknown>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ skip: { ticket_id: Number(ticketId), reason } }),
  });
  return r.ok ? { ok: true } : r;
}
