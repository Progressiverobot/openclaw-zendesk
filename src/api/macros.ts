/**
 * Zendesk Macros API – list, apply, CRUD.
 * https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/
 */

import type { ZendeskMacro, ZendeskTicket } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch, zdFetchCached, invalidateCacheFor } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type OkMacro = { ok: true; macro: ZendeskMacro };
type OkMacros = { ok: true; macros: ZendeskMacro[] };
type Err = { ok: false; status: number; error: string };

export async function getMacro(c: Creds, macroId: string | number): Promise<OkMacro | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/macros/${macroId}.json`;
  const r = await zdFetchCached<{ macro: ZendeskMacro }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, macro: r.data.macro } : r;
}

export async function listMacros(
  c: Creds,
  opts: { active?: boolean; page?: number; perPage?: number } = {},
): Promise<OkMacros | Err> {
  const p = new URLSearchParams();
  if (opts.active !== undefined) p.set("active", String(opts.active));
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  const url = `${buildBaseUrl(c.subdomain)}/macros.json?${p}`;
  const r = await zdFetchCached<{ macros: ZendeskMacro[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, macros: r.data.macros } : r;
}

export async function searchMacros(c: Creds, query: string): Promise<OkMacros | Err> {
  const p = new URLSearchParams({ query });
  const url = `${buildBaseUrl(c.subdomain)}/macros/search.json?${p}`;
  const r = await zdFetchCached<{ macros: ZendeskMacro[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, macros: r.data.macros } : r;
}

/** Apply a macro to a ticket. Returns the resulting ticket. */
export async function applyMacro(
  c: Creds,
  ticketId: string | number,
  macroId: string | number,
): Promise<{ ok: true; ticket: ZendeskTicket; comment: unknown } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}/macros/${macroId}/apply.json`;
  const r = await zdFetchRetry<{ result: { ticket: ZendeskTicket; comment: unknown } }>(
    url,
    c.agentEmail,
    c.apiToken,
    { method: "GET" },
  );
  if (!r.ok) return r;
  // Apply is a preview — we must still commit the ticket update
  const applyResult = r.data.result;
  const updateUrl = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}.json`;
  const ur = await zdFetchRetry<{ ticket: ZendeskTicket }>(updateUrl, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ ticket: applyResult.ticket }),
  });
  if (ur.ok) invalidateCacheFor(`/tickets/${ticketId}`);
  return ur.ok ? { ok: true, ticket: ur.data.ticket, comment: applyResult.comment } : ur;
}

export async function createMacro(
  c: Creds,
  fields: { title: string; actions: Array<{ field: string; value: unknown }>; active?: boolean },
): Promise<OkMacro | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/macros.json`;
  const r = await zdFetchRetry<{ macro: ZendeskMacro }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ macro: fields }),
  });
  return r.ok ? { ok: true, macro: r.data.macro } : r;
}

export async function updateMacro(
  c: Creds,
  macroId: string | number,
  updates: { title?: string; actions?: Array<{ field: string; value: unknown }>; active?: boolean },
): Promise<OkMacro | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/macros/${macroId}.json`;
  const r = await zdFetchRetry<{ macro: ZendeskMacro }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ macro: updates }),
  });
  return r.ok ? { ok: true, macro: r.data.macro } : r;
}

export async function deleteMacro(c: Creds, macroId: string | number): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/macros/${macroId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}
