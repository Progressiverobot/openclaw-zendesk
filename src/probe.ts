/**
 * Zendesk connectivity probe.
 *
 * Called by the gateway on startup (and by `openclaw channels status --probe`)
 * to verify that credentials are correct and the Zendesk API is reachable.
 *
 * Checks performed:
 *   1. GET /api/v2/account.json  – verifies subdomain + auth
 *   2. Confirms the authenticated agent has ticket:write scope
 *      by fetching GET /api/v2/users/me.json and checking role
 */

import type { ResolvedZendeskAccount } from "./types.js";
import { withRetry } from "./retry.js";

interface ZendeskAccountInfo {
  subdomain: string;
  name: string;
  status: string;
}

interface ZendeskCurrentUser {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

function buildAuthHeader(agentEmail: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${agentEmail}/token:${apiToken}`).toString("base64")}`;
}

async function apiFetch<T>(
  url: string,
  agentEmail: string,
  apiToken: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: buildAuthHeader(agentEmail, apiToken),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body || `HTTP ${res.status}` };
  }

  return { ok: true, data: (await res.json()) as T };
}

export interface ProbeResult {
  ok: boolean;
  /** Short human-readable status line */
  status: string;
  /** Extra detail – shown with `--deep` */
  detail?: string;
  /** Authoritative error message if ok=false */
  error?: string;
}

/**
 * Run a lightweight connectivity + auth check against the Zendesk API.
 * Returns a `ProbeResult` that the OpenClaw status command can display.
 */
export async function probeZendesk(account: ResolvedZendeskAccount): Promise<ProbeResult> {
  if (!account.enabled) {
    return { ok: false, status: "disabled", error: "Account is disabled in config" };
  }

  if (!account.subdomain || !account.agentEmail || !account.apiToken) {
    return {
      ok: false,
      status: "misconfigured",
      error: "Missing one or more required fields: subdomain, agentEmail, apiToken",
    };
  }

  const base = `https://${account.subdomain}.zendesk.com/api/v2`;

  // 1. Verify account (subdomain reachable + auth valid)
  const accountResult = await withRetry<{ account: ZendeskAccountInfo }>(
    () => apiFetch(`${base}/account.json`, account.agentEmail, account.apiToken),
    { maxAttempts: 2, baseDelayMs: 400 },
  );

  if (!accountResult.ok) {
    const hint =
      accountResult.status === 401
        ? "Check agentEmail and apiToken."
        : accountResult.status === 404
          ? "Check subdomain – the Zendesk account may not exist."
          : `HTTP ${accountResult.status}`;
    return {
      ok: false,
      status: "auth_failed",
      error: `Zendesk API authentication failed. ${hint}`,
    };
  }

  const zdAccount = accountResult.data.account;

  // 2. Verify agent identity and role
  const meResult = await withRetry<{ user: ZendeskCurrentUser }>(
    () => apiFetch(`${base}/users/me.json`, account.agentEmail, account.apiToken),
    { maxAttempts: 2, baseDelayMs: 400 },
  );

  if (!meResult.ok) {
    return {
      ok: false,
      status: "agent_lookup_failed",
      error: `Could not resolve agent user. HTTP ${meResult.status}`,
    };
  }

  const agent = meResult.data.user;

  if (!agent.active) {
    return {
      ok: false,
      status: "agent_suspended",
      error: `Agent account "${agent.email}" is suspended or deactivated in Zendesk.`,
    };
  }

  const hasWriteRole = ["admin", "agent"].includes(agent.role);
  if (!hasWriteRole) {
    return {
      ok: false,
      status: "insufficient_role",
      error: `Agent "${agent.email}" has role "${agent.role}". Must be "agent" or "admin" to add ticket comments.`,
    };
  }

  return {
    ok: true,
    status: "connected",
    detail: [
      `Zendesk account: ${zdAccount.name} (${zdAccount.subdomain})`,
      `Agent: ${agent.name} <${agent.email}> (role: ${agent.role})`,
      `Webhook path: ${account.webhookPath}`,
      `Signature verification: ${account.webhookSecret ? "enabled" : "DISABLED – set webhookSecret"}`,
    ].join("\n"),
  };
}
