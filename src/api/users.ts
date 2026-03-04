/**
 * Zendesk Users API – CRUD, search, identities, user tags.
 * https://developer.zendesk.com/api-reference/ticketing/users/users/
 */

import type { ZendeskUser } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type OkUser = { ok: true; user: ZendeskUser };
type OkUsers = { ok: true; users: ZendeskUser[]; count: number; nextPage: string | null };
type Err = { ok: false; status: number; error: string };

export async function getUser(c: Creds, userId: string | number): Promise<OkUser | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/users/${userId}.json`;
  const r = await zdFetchRetry<{ user: ZendeskUser }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, user: r.data.user } : r;
}

export async function getCurrentUser(c: Creds): Promise<OkUser | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/users/me.json`;
  const r = await zdFetchRetry<{ user: ZendeskUser }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, user: r.data.user } : r;
}

export async function listUsers(
  c: Creds,
  opts: { role?: string; page?: number; perPage?: number } = {},
): Promise<OkUsers | Err> {
  const p = new URLSearchParams();
  if (opts.role) p.set("role", opts.role);
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  const url = `${buildBaseUrl(c.subdomain)}/users.json?${p}`;
  const r = await zdFetchRetry<{ users: ZendeskUser[]; count: number; next_page: string | null }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok
    ? { ok: true, users: r.data.users, count: r.data.count, nextPage: r.data.next_page }
    : r;
}

export async function searchUsers(
  c: Creds,
  query: string,
  opts: { page?: number; perPage?: number } = {},
): Promise<OkUsers | Err> {
  const p = new URLSearchParams({ query });
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  const url = `${buildBaseUrl(c.subdomain)}/users/search.json?${p}`;
  const r = await zdFetchRetry<{ users: ZendeskUser[]; count: number; next_page: string | null }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok
    ? { ok: true, users: r.data.users, count: r.data.count, nextPage: r.data.next_page }
    : r;
}

export async function searchUserByEmail(
  c: Creds,
  email: string,
): Promise<{ ok: true; user: ZendeskUser | null } | Err> {
  const r = await searchUsers(c, `email:${email}`);
  if (!r.ok) return r;
  return { ok: true, user: r.users[0] ?? null };
}

export async function createUser(
  c: Creds,
  fields: { name: string; email?: string; role?: string; organization_id?: number; phone?: string; notes?: string },
): Promise<OkUser | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/users.json`;
  const r = await zdFetchRetry<{ user: ZendeskUser }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ user: fields }),
  });
  return r.ok ? { ok: true, user: r.data.user } : r;
}

export async function updateUser(
  c: Creds,
  userId: string | number,
  updates: { name?: string; email?: string; role?: string; phone?: string; notes?: string; organization_id?: number },
): Promise<OkUser | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/users/${userId}.json`;
  const r = await zdFetchRetry<{ user: ZendeskUser }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ user: updates }),
  });
  return r.ok ? { ok: true, user: r.data.user } : r;
}

export async function deleteUser(c: Creds, userId: string | number): Promise<{ ok: true; user: ZendeskUser } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/users/${userId}.json`;
  const r = await zdFetch<{ user: ZendeskUser }>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true, user: r.data.user } : r;
}

/** Create or update a user (upsert). If user already exists by email, updates them. */
export async function createOrUpdateUser(
  c: Creds,
  fields: { name: string; email?: string; role?: string; organization_id?: number },
): Promise<OkUser | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/users/create_or_update.json`;
  const r = await zdFetchRetry<{ user: ZendeskUser }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ user: fields }),
  });
  return r.ok ? { ok: true, user: r.data.user } : r;
}

// ---------------------------------------------------------------------------
// User identities (email, phone, etc.)
// ---------------------------------------------------------------------------

export interface UserIdentity {
  id: number;
  user_id: number;
  type: string;
  value: string;
  primary: boolean;
  verified: boolean;
  created_at: string;
  updated_at: string;
}

export async function listUserIdentities(
  c: Creds,
  userId: string | number,
): Promise<{ ok: true; identities: UserIdentity[] } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/users/${userId}/identities.json`;
  const r = await zdFetchRetry<{ identities: UserIdentity[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, identities: r.data.identities } : r;
}

export async function addUserIdentity(
  c: Creds,
  userId: string | number,
  type: string,
  value: string,
): Promise<{ ok: true; identity: UserIdentity } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/users/${userId}/identities.json`;
  const r = await zdFetchRetry<{ identity: UserIdentity }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ identity: { type, value } }),
  });
  return r.ok ? { ok: true, identity: r.data.identity } : r;
}

// ---------------------------------------------------------------------------
// User tags
// ---------------------------------------------------------------------------

export async function getUserTags(c: Creds, userId: string | number): Promise<{ ok: true; tags: string[] } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/users/${userId}/tags.json`;
  const r = await zdFetchRetry<{ tags: string[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, tags: r.data.tags } : r;
}

export async function setUserTags(
  c: Creds,
  userId: string | number,
  tags: string[],
): Promise<{ ok: true; tags: string[] } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/users/${userId}/tags.json`;
  const r = await zdFetchRetry<{ tags: string[] }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
  return r.ok ? { ok: true, tags: r.data.tags } : r;
}
