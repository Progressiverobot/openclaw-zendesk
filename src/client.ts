/**
 * Zendesk Support REST API v2 client.
 *
 * Authentication: Basic Auth using {agentEmail}/token:{apiToken}.
 * Base URL: https://{subdomain}.zendesk.com/api/v2
 *
 * Includes:
 *   - Retry-aware fetch wrapper (respects Retry-After headers on 429)
 *   - Ticket CRUD: get, update status/priority/tags
 *   - Comment: add public reply or internal note
 *   - Attachments: upload file → attach to comment
 *   - Cursor-based pagination for listing comments
 *   - Outbound rate-limit tracking from X-Rate-Limit-* response headers
 *   - HMAC-SHA256 webhook signature verification
 *
 * References:
 *   https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/
 *   https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_comments/
 *   https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_attachments/
 *   https://developer.zendesk.com/documentation/event-connectors/webhooks/verifying/
 */

import type { ZendeskTicket, ZendeskComment, ZendeskUser } from "./types.js";
import { withRetry } from "./retry.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildBaseUrl(subdomain: string): string {
  return `https://${subdomain}.zendesk.com/api/v2`;
}

/**
 * Build the Basic Auth header value.
 * Zendesk expects: base64("{email}/token:{apiToken}")
 */
function buildAuthHeader(agentEmail: string, apiToken: string): string {
  const credentials = `${agentEmail}/token:${apiToken}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Outbound rate-limit tracking
// Zendesk returns X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset
// We track remaining and pause automatically when it hits zero.
// ---------------------------------------------------------------------------

interface RateLimitState {
  remaining: number;
  resetAt: number; // Unix ms
}

const rateLimitState = new Map<string, RateLimitState>();

function updateRateLimit(subdomain: string, headers: Headers): void {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining !== null && reset !== null) {
    rateLimitState.set(subdomain, {
      remaining: parseInt(remaining, 10),
      resetAt: parseInt(reset, 10) * 1000,
    });
  }
}

async function waitForRateLimit(subdomain: string): Promise<void> {
  const state = rateLimitState.get(subdomain);
  if (!state) return;
  if (state.remaining > 0) return;

  const waitMs = Math.max(0, state.resetAt - Date.now()) + 100;
  if (waitMs > 0 && waitMs < 120_000) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function zendeskFetch<T>(
  url: string,
  agentEmail: string,
  apiToken: string,
  options: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  // Extract subdomain from URL for rate-limit tracking
  const subdomainMatch = url.match(/https:\/\/([^.]+)\.zendesk\.com/);
  const subdomain = subdomainMatch?.[1] ?? "";

  await waitForRateLimit(subdomain);

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: buildAuthHeader(agentEmail, apiToken),
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (subdomain) updateRateLimit(subdomain, res.headers);

  if (!res.ok) {
    // Surface Retry-After for 429 so callers / withRetry can use it
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: body || `Zendesk API error: HTTP ${res.status}`,
    };
  }

  const data = (await res.json()) as T;
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Ticket operations
// ---------------------------------------------------------------------------

/**
 * Fetch a single ticket by ID.
 */
export async function getTicket(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  ticketId: string | number,
): Promise<{ ok: true; ticket: ZendeskTicket } | { ok: false; status: number; error: string }> {
  const url = `${buildBaseUrl(subdomain)}/tickets/${ticketId}.json`;
  const result = await withRetry(() => zendeskFetch<{ ticket: ZendeskTicket }>(url, agentEmail, apiToken));
  if (!result.ok) return result;
  return { ok: true, ticket: result.data.ticket };
}

/**
 * Add a comment to an existing ticket.
 * Set `isPublic=true` for an end-user-visible reply, false for an internal note.
 */
export async function addTicketComment(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  ticketId: string | number,
  body: string,
  isPublic = true,
): Promise<{ ok: true; ticket: ZendeskTicket } | { ok: false; status: number; error: string }> {
  const url = `${buildBaseUrl(subdomain)}/tickets/${ticketId}.json`;
  const payload = {
    ticket: {
      comment: {
        body,
        public: isPublic,
      },
    },
  };

  const result = await withRetry(() =>
    zendeskFetch<{ ticket: ZendeskTicket }>(url, agentEmail, apiToken, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  );

  if (!result.ok) return result;
  return { ok: true, ticket: result.data.ticket };
}

/**
 * Update ticket metadata: status, priority, and/or tags.
 *
 * status:   "open" | "pending" | "solved" | "closed"
 * priority: "low" | "normal" | "high" | "urgent"
 * tags:     replaces the full tag set; use addTicketTags for additive updates
 */
export async function updateTicket(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  ticketId: string | number,
  updates: {
    status?: "open" | "pending" | "solved" | "closed";
    priority?: "low" | "normal" | "high" | "urgent";
    tags?: string[];
    assigneeEmail?: string;
    subject?: string;
  },
): Promise<{ ok: true; ticket: ZendeskTicket } | { ok: false; status: number; error: string }> {
  const url = `${buildBaseUrl(subdomain)}/tickets/${ticketId}.json`;
  const ticketPayload: Record<string, unknown> = {};

  if (updates.status !== undefined) ticketPayload["status"] = updates.status;
  if (updates.priority !== undefined) ticketPayload["priority"] = updates.priority;
  if (updates.tags !== undefined) ticketPayload["tags"] = updates.tags;
  if (updates.subject !== undefined) ticketPayload["subject"] = updates.subject;

  // If assigning by email, resolve the user ID first
  if (updates.assigneeEmail) {
    const userResult = await searchUserByEmail(subdomain, agentEmail, apiToken, updates.assigneeEmail);
    if (userResult.ok && userResult.user) {
      ticketPayload["assignee_id"] = userResult.user.id;
    }
  }

  const result = await withRetry(() =>
    zendeskFetch<{ ticket: ZendeskTicket }>(url, agentEmail, apiToken, {
      method: "PUT",
      body: JSON.stringify({ ticket: ticketPayload }),
    }),
  );

  if (!result.ok) return result;
  return { ok: true, ticket: result.data.ticket };
}

/**
 * Additively merge tags onto a ticket (fetches current tags first).
 */
export async function addTicketTags(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  ticketId: string | number,
  newTags: string[],
): Promise<{ ok: true; ticket: ZendeskTicket } | { ok: false; status: number; error: string }> {
  const current = await getTicket(subdomain, agentEmail, apiToken, ticketId);
  if (!current.ok) return current;

  const merged = Array.from(
    new Set([...(current.ticket as any).tags ?? [], ...newTags]),
  );

  return updateTicket(subdomain, agentEmail, apiToken, ticketId, { tags: merged });
}

// ---------------------------------------------------------------------------
// Comments / pagination
// ---------------------------------------------------------------------------

export interface CommentPage {
  comments: ZendeskComment[];
  /** Pass to next call to get the next page; undefined means no more pages */
  nextCursor?: string;
}

/**
 * List comments on a ticket using cursor-based pagination.
 *
 * @param afterCursor  – pass the `nextCursor` from a previous call to page forward
 * @param pageSize     – max comments per page (Zendesk max: 100)
 */
export async function listTicketCommentsPaged(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  ticketId: string | number,
  afterCursor?: string,
  pageSize = 25,
): Promise<{ ok: true } & CommentPage | { ok: false; status: number; error: string }> {
  const params = new URLSearchParams({
    "page[size]": String(Math.min(pageSize, 100)),
  });
  if (afterCursor) params.set("page[after]", afterCursor);

  const url = `${buildBaseUrl(subdomain)}/tickets/${ticketId}/comments.json?${params}`;

  const result = await withRetry(() =>
    zendeskFetch<{
      comments: ZendeskComment[];
      meta?: { has_more?: boolean; after_cursor?: string };
    }>(url, agentEmail, apiToken),
  );

  if (!result.ok) return result;

  return {
    ok: true,
    comments: result.data.comments,
    nextCursor: result.data.meta?.has_more ? result.data.meta.after_cursor : undefined,
  };
}

/**
 * Convenience: fetch ALL comments across pages (up to `maxComments`).
 * Suitable for building ticket context for the agent.
 */
export async function listTicketComments(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  ticketId: string | number,
  maxComments = 50,
): Promise<
  { ok: true; comments: ZendeskComment[] } | { ok: false; status: number; error: string }
> {
  const allComments: ZendeskComment[] = [];
  let cursor: string | undefined;

  do {
    const page = await listTicketCommentsPaged(
      subdomain,
      agentEmail,
      apiToken,
      ticketId,
      cursor,
      Math.min(maxComments - allComments.length, 100),
    );
    if (!page.ok) return page;
    allComments.push(...page.comments);
    cursor = page.nextCursor;
  } while (cursor && allComments.length < maxComments);

  return { ok: true, comments: allComments };
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface UploadedAttachment {
  token: string;
  contentUrl: string;
  fileName: string;
  contentType: string;
  size: number;
}

/**
 * Upload a file to Zendesk and return the upload token.
 * The token must be included in the `uploads` array when creating a comment.
 *
 * @param fileData  – raw file bytes
 * @param fileName  – original filename (used for content-type detection)
 * @param mimeType  – explicit MIME type; defaults to application/octet-stream
 */
export async function uploadAttachment(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  fileData: Uint8Array | Buffer,
  fileName: string,
  mimeType = "application/octet-stream",
): Promise<{ ok: true; attachment: UploadedAttachment } | { ok: false; status: number; error: string }> {
  const params = new URLSearchParams({ filename: fileName });
  const url = `${buildBaseUrl(subdomain)}/uploads.json?${params}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      Authorization: buildAuthHeader(agentEmail, apiToken),
    },
    body: fileData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body || `Upload failed: HTTP ${res.status}` };
  }

  const data = (await res.json()) as {
    upload: {
      token: string;
      attachment: {
        content_url: string;
        file_name: string;
        content_type: string;
        size: number;
      };
    };
  };

  return {
    ok: true,
    attachment: {
      token: data.upload.token,
      contentUrl: data.upload.attachment.content_url,
      fileName: data.upload.attachment.file_name,
      contentType: data.upload.attachment.content_type,
      size: data.upload.attachment.size,
    },
  };
}

/**
 * Add a comment with one or more pre-uploaded attachments.
 */
export async function addTicketCommentWithAttachments(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  ticketId: string | number,
  body: string,
  uploadTokens: string[],
  isPublic = true,
): Promise<{ ok: true; ticket: ZendeskTicket } | { ok: false; status: number; error: string }> {
  const url = `${buildBaseUrl(subdomain)}/tickets/${ticketId}.json`;
  const payload = {
    ticket: {
      comment: {
        body,
        public: isPublic,
        uploads: uploadTokens,
      },
    },
  };

  const result = await withRetry(() =>
    zendeskFetch<{ ticket: ZendeskTicket }>(url, agentEmail, apiToken, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  );

  if (!result.ok) return result;
  return { ok: true, ticket: result.data.ticket };
}

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------

/**
 * Fetch a Zendesk user by ID.
 */
export async function getUser(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  userId: string | number,
): Promise<{ ok: true; user: ZendeskUser } | { ok: false; status: number; error: string }> {
  const url = `${buildBaseUrl(subdomain)}/users/${userId}.json`;
  const result = await withRetry(() =>
    zendeskFetch<{ user: ZendeskUser }>(url, agentEmail, apiToken),
  );
  if (!result.ok) return result;
  return { ok: true, user: result.data.user };
}

/**
 * Search for a user by email address.
 * Returns the first match, or null if none found.
 */
export async function searchUserByEmail(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  email: string,
): Promise<{ ok: true; user: ZendeskUser | null } | { ok: false; status: number; error: string }> {
  const params = new URLSearchParams({ query: `email:${email}` });
  const url = `${buildBaseUrl(subdomain)}/users/search.json?${params}`;

  const result = await withRetry(() =>
    zendeskFetch<{ users: ZendeskUser[] }>(url, agentEmail, apiToken),
  );

  if (!result.ok) return result;
  return { ok: true, user: result.data.users[0] ?? null };
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify an inbound Zendesk webhook request using HMAC-SHA256.
 *
 * Zendesk signs requests with:
 *   HMAC-SHA256(webhookSecret, timestamp + "." + rawBody)
 *
 * Headers:
 *   X-Zendesk-Webhook-Signature          : base64-encoded HMAC
 *   X-Zendesk-Webhook-Signature-Timestamp: Unix timestamp string
 *
 * Reference: https://developer.zendesk.com/documentation/event-connectors/webhooks/verifying/
 */
export async function verifyWebhookSignature(
  webhookSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  if (!webhookSecret || !timestamp || !signature) return false;

  // Reject requests with timestamps more than 5 minutes old to prevent replay attacks
  const tsMs = parseInt(timestamp, 10) * 1000;
  if (Number.isNaN(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
    return false;
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(webhookSecret);
  const messageData = encoder.encode(`${timestamp}.${rawBody}`);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const expectedSignature = Buffer.from(signatureBuffer).toString("base64");

  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected[i]! ^ provided[i]!;
  }

  return mismatch === 0;
}
