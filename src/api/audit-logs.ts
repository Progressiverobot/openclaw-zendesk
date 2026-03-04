/**
 * Zendesk Audit Logs API.
 * https://developer.zendesk.com/api-reference/ticketing/account-configuration/audit_logs/
 *
 * Built by Progressive Robot Ltd
 */

import type { ZendeskAuditLog } from "../types.js";
import { buildBaseUrl, zdFetchCached } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type Err = { ok: false; status: number; error: string };

export async function getAuditLog(
  c: Creds,
  auditLogId: string | number,
): Promise<{ ok: true; auditLog: ZendeskAuditLog } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/audit_logs/${auditLogId}.json`;
  const r = await zdFetchCached<{ audit_log: ZendeskAuditLog }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, auditLog: r.data.audit_log } : r;
}

export async function listAuditLogs(
  c: Creds,
  opts: {
    filter?: {
      sourceType?: string;
      sourceId?: string | number;
      actorId?: string | number;
      ipAddress?: string;
      createdAt?: string;
      action?: string;
    };
    page?: number;
    perPage?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  } = {},
): Promise<{ ok: true; auditLogs: ZendeskAuditLog[]; count: number; nextPage: string | null } | Err> {
  const p = new URLSearchParams();
  const f = opts.filter ?? {};
  if (f.sourceType) p.set("filter[source_type]", f.sourceType);
  if (f.sourceId) p.set("filter[source_id]", String(f.sourceId));
  if (f.actorId) p.set("filter[actor_id]", String(f.actorId));
  if (f.ipAddress) p.set("filter[ip_address]", f.ipAddress);
  if (f.createdAt) p.set("filter[created_at]", f.createdAt);
  if (f.action) p.set("filter[action]", f.action);
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  if (opts.sortBy) p.set("sort_by", opts.sortBy);
  if (opts.sortOrder) p.set("sort_order", opts.sortOrder);
  const url = `${buildBaseUrl(c.subdomain)}/audit_logs.json?${p}`;
  const r = await zdFetchCached<{
    audit_logs: ZendeskAuditLog[];
    count: number;
    next_page: string | null;
  }>(url, c.agentEmail, c.apiToken);
  return r.ok
    ? { ok: true, auditLogs: r.data.audit_logs, count: r.data.count, nextPage: r.data.next_page }
    : r;
}
