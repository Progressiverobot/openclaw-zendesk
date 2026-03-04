/**
 * Zendesk SLA Policies API.
 * https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/
 */

import type { ZendeskSlaPolicy } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch, zdFetchCached } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type OkSla = { ok: true; slaPolicy: ZendeskSlaPolicy };
type OkSlas = { ok: true; slaPolicies: ZendeskSlaPolicy[] };
type Err = { ok: false; status: number; error: string };

export async function getSlaPolicy(c: Creds, policyId: string | number): Promise<OkSla | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/slas/policies/${policyId}.json`;
  const r = await zdFetchCached<{ sla_policy: ZendeskSlaPolicy }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, slaPolicy: r.data.sla_policy } : r;
}

export async function listSlaPolicies(c: Creds): Promise<OkSlas | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/slas/policies.json`;
  const r = await zdFetchCached<{ sla_policies: ZendeskSlaPolicy[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, slaPolicies: r.data.sla_policies } : r;
}

export async function createSlaPolicy(
  c: Creds,
  fields: {
    title: string;
    description?: string;
    policy_metrics?: ZendeskSlaPolicy["policy_metrics"];
    filter?: { all?: unknown[]; any?: unknown[] };
  },
): Promise<OkSla | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/slas/policies.json`;
  const r = await zdFetchRetry<{ sla_policy: ZendeskSlaPolicy }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ sla_policy: fields }),
  });
  return r.ok ? { ok: true, slaPolicy: r.data.sla_policy } : r;
}

export async function updateSlaPolicy(
  c: Creds,
  policyId: string | number,
  updates: { title?: string; description?: string; policy_metrics?: ZendeskSlaPolicy["policy_metrics"] },
): Promise<OkSla | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/slas/policies/${policyId}.json`;
  const r = await zdFetchRetry<{ sla_policy: ZendeskSlaPolicy }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ sla_policy: updates }),
  });
  return r.ok ? { ok: true, slaPolicy: r.data.sla_policy } : r;
}

export async function deleteSlaPolicy(c: Creds, policyId: string | number): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/slas/policies/${policyId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}

/** Reorder SLA policies. */
export async function reorderSlaPolicies(
  c: Creds,
  policyIds: (string | number)[],
): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/slas/policies/reorder.json`;
  const r = await zdFetchRetry<unknown>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ sla_policy_ids: policyIds }),
  });
  return r.ok ? { ok: true } : r;
}
