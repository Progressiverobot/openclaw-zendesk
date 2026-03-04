/**
 * Zendesk Webhooks Management API (manage webhook definitions, not inbound handler).
 * https://developer.zendesk.com/api-reference/event-connectors/webhooks/webhooks/
 *
 * Built by Progressive Robot Ltd
 */

import type { ZendeskWebhookDef } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch, zdFetchCached, invalidateCacheFor } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type OkWebhook = { ok: true; webhook: ZendeskWebhookDef };
type OkWebhooks = { ok: true; webhooks: ZendeskWebhookDef[] };
type Err = { ok: false; status: number; error: string };

export async function getWebhook(c: Creds, webhookId: string): Promise<OkWebhook | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/webhooks/${webhookId}`;
  const r = await zdFetchCached<{ webhook: ZendeskWebhookDef }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, webhook: r.data.webhook } : r;
}

export async function listWebhooks(
  c: Creds,
  opts: { filter?: { nameContains?: string; status?: string } } = {},
): Promise<OkWebhooks | Err> {
  const p = new URLSearchParams();
  if (opts.filter?.nameContains) p.set("filter[name_contains]", opts.filter.nameContains);
  if (opts.filter?.status) p.set("filter[status]", opts.filter.status);
  const url = `${buildBaseUrl(c.subdomain)}/webhooks?${p}`;
  const r = await zdFetchCached<{ webhooks: ZendeskWebhookDef[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, webhooks: r.data.webhooks } : r;
}

export async function createWebhook(
  c: Creds,
  fields: {
    name: string;
    endpoint: string;
    http_method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    request_format: "json" | "xml" | "form_encoded";
    status: "active" | "inactive";
    subscriptions: string[];
    authentication?: {
      type: string;
      data?: Record<string, unknown>;
      add_position?: string;
    };
  },
): Promise<OkWebhook | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/webhooks`;
  const r = await zdFetchRetry<{ webhook: ZendeskWebhookDef }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ webhook: fields }),
  });
  if (r.ok) invalidateCacheFor("/webhooks");
  return r.ok ? { ok: true, webhook: r.data.webhook } : r;
}

export async function updateWebhook(
  c: Creds,
  webhookId: string,
  updates: {
    name?: string;
    endpoint?: string;
    status?: "active" | "inactive";
    subscriptions?: string[];
  },
): Promise<OkWebhook | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/webhooks/${webhookId}`;
  const r = await zdFetchRetry<{ webhook: ZendeskWebhookDef }>(url, c.agentEmail, c.apiToken, {
    method: "PATCH",
    body: JSON.stringify({ webhook: updates }),
  });
  if (r.ok) invalidateCacheFor(`/webhooks/${webhookId}`);
  return r.ok ? { ok: true, webhook: r.data.webhook } : r;
}

export async function deleteWebhook(c: Creds, webhookId: string): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/webhooks/${webhookId}`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  if (r.ok) invalidateCacheFor(`/webhooks/${webhookId}`);
  return r.ok ? { ok: true } : r;
}

/** Test a webhook by sending a test event. */
export async function testWebhook(
  c: Creds,
  webhookId: string,
  request: { url?: string; request_format?: string; http_method?: string },
): Promise<{ ok: true; status: number } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/webhooks/${webhookId}/test`;
  const r = await zdFetchRetry<{ status: number }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ webhook: request }),
  });
  return r.ok ? { ok: true, status: r.data.status } : r;
}
