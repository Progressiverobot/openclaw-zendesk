/**
 * Zendesk Groups API.
 * https://developer.zendesk.com/api-reference/ticketing/groups/groups/
 */

import type { ZendeskGroup } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type OkGroup = { ok: true; group: ZendeskGroup };
type OkGroups = { ok: true; groups: ZendeskGroup[] };
type Err = { ok: false; status: number; error: string };

export async function getGroup(c: Creds, groupId: string | number): Promise<OkGroup | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/groups/${groupId}.json`;
  const r = await zdFetchRetry<{ group: ZendeskGroup }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, group: r.data.group } : r;
}

export async function listGroups(c: Creds): Promise<OkGroups | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/groups.json`;
  const r = await zdFetchRetry<{ groups: ZendeskGroup[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, groups: r.data.groups } : r;
}

export async function listAssignableGroups(c: Creds): Promise<OkGroups | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/groups/assignable.json`;
  const r = await zdFetchRetry<{ groups: ZendeskGroup[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, groups: r.data.groups } : r;
}

export async function createGroup(
  c: Creds,
  name: string,
  description?: string,
): Promise<OkGroup | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/groups.json`;
  const r = await zdFetchRetry<{ group: ZendeskGroup }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ group: { name, description } }),
  });
  return r.ok ? { ok: true, group: r.data.group } : r;
}

export async function updateGroup(
  c: Creds,
  groupId: string | number,
  updates: { name?: string; description?: string },
): Promise<OkGroup | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/groups/${groupId}.json`;
  const r = await zdFetchRetry<{ group: ZendeskGroup }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ group: updates }),
  });
  return r.ok ? { ok: true, group: r.data.group } : r;
}

export async function deleteGroup(c: Creds, groupId: string | number): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/groups/${groupId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}

// ---------------------------------------------------------------------------
// Group memberships
// ---------------------------------------------------------------------------

export interface GroupMembership {
  id: number;
  user_id: number;
  group_id: number;
  default: boolean;
  created_at: string;
  updated_at: string;
}

export async function listGroupMemberships(
  c: Creds,
  groupId?: string | number,
): Promise<{ ok: true; memberships: GroupMembership[] } | Err> {
  const url = groupId
    ? `${buildBaseUrl(c.subdomain)}/groups/${groupId}/memberships.json`
    : `${buildBaseUrl(c.subdomain)}/group_memberships.json`;
  const r = await zdFetchRetry<{ group_memberships: GroupMembership[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, memberships: r.data.group_memberships } : r;
}

export async function addGroupMembership(
  c: Creds,
  userId: string | number,
  groupId: string | number,
): Promise<{ ok: true; membership: GroupMembership } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/group_memberships.json`;
  const r = await zdFetchRetry<{ group_membership: GroupMembership }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ group_membership: { user_id: userId, group_id: groupId } }),
  });
  return r.ok ? { ok: true, membership: r.data.group_membership } : r;
}

export async function deleteGroupMembership(
  c: Creds,
  membershipId: string | number,
): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/group_memberships/${membershipId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}
