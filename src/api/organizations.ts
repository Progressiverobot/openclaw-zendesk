/**
 * Zendesk Organizations API.
 * https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/
 */

import type { ZendeskOrganization } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type OkOrg = { ok: true; organization: ZendeskOrganization };
type OkOrgs = { ok: true; organizations: ZendeskOrganization[]; count: number; nextPage: string | null };
type Err = { ok: false; status: number; error: string };

export async function getOrganization(c: Creds, orgId: string | number): Promise<OkOrg | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/organizations/${orgId}.json`;
  const r = await zdFetchRetry<{ organization: ZendeskOrganization }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, organization: r.data.organization } : r;
}

export async function listOrganizations(
  c: Creds,
  opts: { page?: number; perPage?: number } = {},
): Promise<OkOrgs | Err> {
  const p = new URLSearchParams();
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  const url = `${buildBaseUrl(c.subdomain)}/organizations.json?${p}`;
  const r = await zdFetchRetry<{
    organizations: ZendeskOrganization[];
    count: number;
    next_page: string | null;
  }>(url, c.agentEmail, c.apiToken);
  return r.ok
    ? { ok: true, organizations: r.data.organizations, count: r.data.count, nextPage: r.data.next_page }
    : r;
}

export async function searchOrganizations(
  c: Creds,
  query: string,
): Promise<OkOrgs | Err> {
  const p = new URLSearchParams({ query });
  const url = `${buildBaseUrl(c.subdomain)}/organizations/search.json?${p}`;
  const r = await zdFetchRetry<{
    organizations: ZendeskOrganization[];
    count: number;
    next_page: string | null;
  }>(url, c.agentEmail, c.apiToken);
  return r.ok
    ? { ok: true, organizations: r.data.organizations, count: r.data.count, nextPage: r.data.next_page }
    : r;
}

export async function createOrganization(
  c: Creds,
  fields: { name: string; domain_names?: string[]; tags?: string[]; notes?: string; details?: string },
): Promise<OkOrg | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/organizations.json`;
  const r = await zdFetchRetry<{ organization: ZendeskOrganization }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ organization: fields }),
  });
  return r.ok ? { ok: true, organization: r.data.organization } : r;
}

export async function updateOrganization(
  c: Creds,
  orgId: string | number,
  updates: { name?: string; domain_names?: string[]; tags?: string[]; notes?: string; details?: string },
): Promise<OkOrg | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/organizations/${orgId}.json`;
  const r = await zdFetchRetry<{ organization: ZendeskOrganization }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ organization: updates }),
  });
  return r.ok ? { ok: true, organization: r.data.organization } : r;
}

export async function deleteOrganization(c: Creds, orgId: string | number): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/organizations/${orgId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}

// ---------------------------------------------------------------------------
// Organization members
// ---------------------------------------------------------------------------

export async function listOrgMembers(
  c: Creds,
  orgId: string | number,
  opts: { page?: number; perPage?: number } = {},
): Promise<{ ok: true; users: unknown[]; count: number } | Err> {
  const p = new URLSearchParams();
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(opts.perPage));
  const url = `${buildBaseUrl(c.subdomain)}/organizations/${orgId}/users.json?${p}`;
  const r = await zdFetchRetry<{ users: unknown[]; count: number }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, users: r.data.users, count: r.data.count } : r;
}

// ---------------------------------------------------------------------------
// Organization tags
// ---------------------------------------------------------------------------

export async function getOrgTags(c: Creds, orgId: string | number): Promise<{ ok: true; tags: string[] } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/organizations/${orgId}/tags.json`;
  const r = await zdFetchRetry<{ tags: string[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, tags: r.data.tags } : r;
}

export async function setOrgTags(
  c: Creds,
  orgId: string | number,
  tags: string[],
): Promise<{ ok: true; tags: string[] } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/organizations/${orgId}/tags.json`;
  const r = await zdFetchRetry<{ tags: string[] }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
  return r.ok ? { ok: true, tags: r.data.tags } : r;
}
