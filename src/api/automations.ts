/**
 * Zendesk Automations API.
 * https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/
 */

import type { ZendeskAutomation } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch, zdFetchCached, invalidateCacheFor } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type OkAuto = { ok: true; automation: ZendeskAutomation };
type OkAutos = { ok: true; automations: ZendeskAutomation[] };
type Err = { ok: false; status: number; error: string };

export async function getAutomation(c: Creds, automationId: string | number): Promise<OkAuto | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/automations/${automationId}.json`;
  const r = await zdFetchCached<{ automation: ZendeskAutomation }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, automation: r.data.automation } : r;
}

export async function listAutomations(
  c: Creds,
  opts: { active?: boolean } = {},
): Promise<OkAutos | Err> {
  const p = new URLSearchParams();
  if (opts.active !== undefined) p.set("active", String(opts.active));
  const url = `${buildBaseUrl(c.subdomain)}/automations.json?${p}`;
  const r = await zdFetchCached<{ automations: ZendeskAutomation[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, automations: r.data.automations } : r;
}

export async function createAutomation(
  c: Creds,
  fields: {
    title: string;
    active?: boolean;
    conditions: ZendeskAutomation["conditions"];
    actions: Array<{ field: string; value: unknown }>;
  },
): Promise<OkAuto | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/automations.json`;
  const r = await zdFetchRetry<{ automation: ZendeskAutomation }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ automation: fields }),
  });
  if (r.ok) invalidateCacheFor("/automations");
  return r.ok ? { ok: true, automation: r.data.automation } : r;
}

export async function updateAutomation(
  c: Creds,
  automationId: string | number,
  updates: { title?: string; active?: boolean; conditions?: ZendeskAutomation["conditions"]; actions?: Array<{ field: string; value: unknown }> },
): Promise<OkAuto | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/automations/${automationId}.json`;
  const r = await zdFetchRetry<{ automation: ZendeskAutomation }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ automation: updates }),
  });
  if (r.ok) invalidateCacheFor(`/automations/${automationId}`);
  return r.ok ? { ok: true, automation: r.data.automation } : r;
}

export async function deleteAutomation(c: Creds, automationId: string | number): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/automations/${automationId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  if (r.ok) invalidateCacheFor(`/automations/${automationId}`);
  return r.ok ? { ok: true } : r;
}
