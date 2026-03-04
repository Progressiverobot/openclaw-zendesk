/**
 * Zendesk Triggers API.
 * https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/
 */

import type { ZendeskTrigger } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch, zdFetchCached } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type OkTrigger = { ok: true; trigger: ZendeskTrigger };
type OkTriggers = { ok: true; triggers: ZendeskTrigger[] };
type Err = { ok: false; status: number; error: string };

export async function getTrigger(c: Creds, triggerId: string | number): Promise<OkTrigger | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/triggers/${triggerId}.json`;
  const r = await zdFetchCached<{ trigger: ZendeskTrigger }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, trigger: r.data.trigger } : r;
}

export async function listTriggers(
  c: Creds,
  opts: { active?: boolean } = {},
): Promise<OkTriggers | Err> {
  const p = new URLSearchParams();
  if (opts.active !== undefined) p.set("active", String(opts.active));
  const url = `${buildBaseUrl(c.subdomain)}/triggers.json?${p}`;
  const r = await zdFetchCached<{ triggers: ZendeskTrigger[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, triggers: r.data.triggers } : r;
}

export async function searchTriggers(c: Creds, query: string): Promise<OkTriggers | Err> {
  const p = new URLSearchParams({ query });
  const url = `${buildBaseUrl(c.subdomain)}/triggers/search.json?${p}`;
  const r = await zdFetchCached<{ triggers: ZendeskTrigger[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, triggers: r.data.triggers } : r;
}

export async function createTrigger(
  c: Creds,
  fields: {
    title: string;
    active?: boolean;
    conditions: ZendeskTrigger["conditions"];
    actions: Array<{ field: string; value: unknown }>;
  },
): Promise<OkTrigger | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/triggers.json`;
  const r = await zdFetchRetry<{ trigger: ZendeskTrigger }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ trigger: fields }),
  });
  return r.ok ? { ok: true, trigger: r.data.trigger } : r;
}

export async function updateTrigger(
  c: Creds,
  triggerId: string | number,
  updates: { title?: string; active?: boolean; conditions?: ZendeskTrigger["conditions"]; actions?: Array<{ field: string; value: unknown }> },
): Promise<OkTrigger | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/triggers/${triggerId}.json`;
  const r = await zdFetchRetry<{ trigger: ZendeskTrigger }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ trigger: updates }),
  });
  return r.ok ? { ok: true, trigger: r.data.trigger } : r;
}

export async function deleteTrigger(c: Creds, triggerId: string | number): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/triggers/${triggerId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}
