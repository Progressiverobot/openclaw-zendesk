/**
 * Zendesk Suspended Tickets API.
 * https://developer.zendesk.com/api-reference/ticketing/tickets/suspended_tickets/
 *
 * Built by Progressive Robot Ltd
 */

import type { ZendeskSuspendedTicket } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch, zdFetchCached } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type Err = { ok: false; status: number; error: string };

export async function listSuspendedTickets(
  c: Creds,
  opts: { page?: number; perPage?: number } = {},
): Promise<{ ok: true; suspendedTickets: ZendeskSuspendedTicket[]; count: number } | Err> {
  const p = new URLSearchParams();
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  const url = `${buildBaseUrl(c.subdomain)}/suspended_tickets.json?${p}`;
  const r = await zdFetchCached<{ suspended_tickets: ZendeskSuspendedTicket[]; count: number }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok
    ? { ok: true, suspendedTickets: r.data.suspended_tickets, count: r.data.count }
    : r;
}

export async function getSuspendedTicket(
  c: Creds,
  suspendedId: string | number,
): Promise<{ ok: true; suspendedTicket: ZendeskSuspendedTicket } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/suspended_tickets/${suspendedId}.json`;
  const r = await zdFetchCached<{ suspended_ticket: ZendeskSuspendedTicket }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok ? { ok: true, suspendedTicket: r.data.suspended_ticket } : r;
}

/** Recover a suspended ticket, creating a real ticket from it. */
export async function recoverSuspendedTicket(
  c: Creds,
  suspendedId: string | number,
): Promise<{ ok: true; ticket: unknown } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/suspended_tickets/${suspendedId}/recover.json`;
  const r = await zdFetchRetry<{ ticket: unknown }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
  });
  return r.ok ? { ok: true, ticket: r.data.ticket } : r;
}

/** Recover multiple suspended tickets at once. */
export async function recoverManySuspendedTickets(
  c: Creds,
  ids: (string | number)[],
): Promise<{ ok: true } | Err> {
  const p = new URLSearchParams({ ids: ids.join(",") });
  const url = `${buildBaseUrl(c.subdomain)}/suspended_tickets/recover_many.json?${p}`;
  const r = await zdFetchRetry<unknown>(url, c.agentEmail, c.apiToken, { method: "PUT" });
  return r.ok ? { ok: true } : r;
}

/** Permanently delete a suspended ticket. */
export async function deleteSuspendedTicket(
  c: Creds,
  suspendedId: string | number,
): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/suspended_tickets/${suspendedId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}

/** Delete many suspended tickets at once. */
export async function deleteManySuspendedTickets(
  c: Creds,
  ids: (string | number)[],
): Promise<{ ok: true } | Err> {
  const p = new URLSearchParams({ ids: ids.join(",") });
  const url = `${buildBaseUrl(c.subdomain)}/suspended_tickets/destroy_many.json?${p}`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}
