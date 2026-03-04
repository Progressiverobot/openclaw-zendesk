/**
 * Zendesk Ticket Comments API.
 * https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_comments/
 */

import type { ZendeskComment } from "../types.js";
import { buildBaseUrl, zdFetchRetry, zdFetch, cursorParams } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type Err = { ok: false; status: number; error: string };

export interface CommentPage {
  comments: ZendeskComment[];
  nextCursor?: string;
  hasMore: boolean;
}

export async function listCommentsPaged(
  c: Creds,
  ticketId: string | number,
  pageSize = 25,
  afterCursor?: string,
): Promise<{ ok: true } & CommentPage | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}/comments.json?${cursorParams(pageSize, afterCursor)}`;
  const r = await zdFetchRetry<{
    comments: ZendeskComment[];
    meta?: { has_more?: boolean; after_cursor?: string };
  }>(url, c.agentEmail, c.apiToken);
  if (!r.ok) return r;
  return {
    ok: true,
    comments: r.data.comments,
    hasMore: r.data.meta?.has_more ?? false,
    nextCursor: r.data.meta?.has_more ? r.data.meta.after_cursor : undefined,
  };
}

/** Fetch all comments for a ticket (up to maxComments). */
export async function listAllComments(
  c: Creds,
  ticketId: string | number,
  maxComments = 50,
): Promise<{ ok: true; comments: ZendeskComment[] } | Err> {
  const all: ZendeskComment[] = [];
  let cursor: string | undefined;
  do {
    const page = await listCommentsPaged(c, ticketId, Math.min(maxComments - all.length, 100), cursor);
    if (!page.ok) return page;
    all.push(...page.comments);
    cursor = page.nextCursor;
  } while (cursor && all.length < maxComments);
  return { ok: true, comments: all };
}

/** Add a public reply or internal note to a ticket. */
export async function addComment(
  c: Creds,
  ticketId: string | number,
  body: string,
  isPublic = true,
  uploadTokens?: string[],
): Promise<{ ok: true; ticket: unknown } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}.json`;
  const comment: Record<string, unknown> = { body, public: isPublic };
  if (uploadTokens?.length) comment["uploads"] = uploadTokens;
  const r = await zdFetchRetry<{ ticket: unknown }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ ticket: { comment } }),
  });
  return r.ok ? { ok: true, ticket: r.data.ticket } : r;
}

/** Redact a specific word/phrase from a comment (permanent). */
export async function redactCommentString(
  c: Creds,
  ticketId: string | number,
  commentId: string | number,
  text: string,
): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}/comments/${commentId}/redact.json`;
  const r = await zdFetchRetry<unknown>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
  return r.ok ? { ok: true } : r;
}

/** Make a public comment private (internal note). */
export async function makeCommentPrivate(
  c: Creds,
  ticketId: string | number,
  commentId: string | number,
): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/tickets/${ticketId}/comments/${commentId}/make_private.json`;
  const r = await zdFetch<unknown>(url, c.agentEmail, c.apiToken, { method: "PUT" });
  return r.ok ? { ok: true } : r;
}
