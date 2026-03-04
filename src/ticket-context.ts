/**
 * Ticket context enrichment.
 *
 * Fetches full ticket metadata + comment history and formats it as a
 * structured string injected into the agent's system prompt context.
 * This gives the agent the full picture before it replies – requester info,
 * current status/priority, and the entire conversation thread.
 */

import { getTicket } from "./api/tickets.js";
import { listAllComments } from "./api/comments.js";
import { getUser } from "./api/users.js";
import type { ZendeskTicket, ZendeskComment, ZendeskUser } from "./types.js";

export interface TicketContext {
  ticket: ZendeskTicket;
  requester: ZendeskUser | null;
  comments: ZendeskComment[];
  /** Pre-formatted markdown block ready for the agent prompt */
  formatted: string;
}

const PRIORITY_EMOJI: Record<string, string> = {
  urgent: "🔴",
  high: "🟠",
  normal: "🟡",
  low: "🟢",
};

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  open: "Open",
  pending: "Pending (waiting on customer)",
  hold: "On Hold",
  solved: "Solved",
  closed: "Closed",
};

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return isoString;
  }
}

function formatComment(comment: ZendeskComment, authorName: string): string {
  const visibility = comment.public ? "public" : "internal note";
  const timestamp = formatDate(comment.created_at);
  return [
    `[${timestamp}] ${authorName} (${visibility}):`,
    comment.plain_body || comment.body,
  ].join("\n");
}

/**
 * Fetch ticket + comment history and return structured context.
 * Silently degrades if individual API calls fail (returns partial context).
 *
 * @param maxComments  Maximum recent comments to include (default: 20).
 *                     Keeps prompt size manageable for long tickets.
 */
export async function buildTicketContext(
  subdomain: string,
  agentEmail: string,
  apiToken: string,
  ticketId: string | number,
  maxComments = 20,
): Promise<TicketContext> {
  const creds = { subdomain, agentEmail, apiToken };
  // Fetch in parallel
  const [ticketResult, commentsResult] = await Promise.all([
    getTicket(creds, ticketId),
    listAllComments(creds, ticketId, maxComments),
  ]);

  const ticket = ticketResult.ok ? ticketResult.ticket : null;
  const comments = commentsResult.ok ? commentsResult.comments : [];

  // Fetch requester info if we have a ticket
  let requester: ZendeskUser | null = null;
  if (ticket?.requester_id) {
    const userResult = await getUser(creds, ticket.requester_id).catch(() => null);
    requester = userResult?.ok ? userResult.user : null;
  }

  // Build a name lookup for comment authors (batch-resolve unique author IDs)
  const authorIds = [...new Set(comments.map((c) => c.author_id))];
  const authorNames = new Map<number, string>();
  if (requester) authorNames.set(requester.id, requester.name);

  await Promise.all(
    authorIds
      .filter((id) => !authorNames.has(id))
      .map(async (id) => {
        const r = await getUser(creds, id).catch(() => null);
        if (r?.ok) authorNames.set(r.user.id, r.user.name);
      }),
  );

  // -------------------------------------------------------------------
  // Format the context block
  // -------------------------------------------------------------------
  const lines: string[] = [];

  if (ticket) {
    const priorityEmoji = PRIORITY_EMOJI[(ticket as any).priority] ?? "⚪";
    const statusLabel = STATUS_LABEL[ticket.status] ?? ticket.status;

    lines.push("## Zendesk Ticket Context");
    lines.push("");
    lines.push(`**Ticket #${ticket.id}** – ${ticket.subject}`);
    lines.push(`- **Status**: ${statusLabel}`);
    lines.push(`- **Priority**: ${priorityEmoji} ${(ticket as any).priority ?? "not set"}`);
    lines.push(
      `- **Requester**: ${requester ? `${requester.name} <${requester.email}>` : `User #${ticket.requester_id}`}`,
    );
    lines.push(`- **Created**: ${formatDate(ticket.created_at)}`);
    lines.push(`- **Last updated**: ${formatDate(ticket.updated_at)}`);
    if ((ticket as any).tags?.length) {
      lines.push(`- **Tags**: ${(ticket as any).tags.join(", ")}`);
    }
    lines.push("");
  } else {
    lines.push(`## Zendesk Ticket #${ticketId} (metadata unavailable)`);
    lines.push("");
  }

  if (comments.length > 0) {
    lines.push(`### Conversation history (${comments.length} comments)`);
    lines.push("");
    for (const comment of comments) {
      const authorName = authorNames.get(comment.author_id) ?? `User #${comment.author_id}`;
      lines.push(formatComment(comment, authorName));
      lines.push("");
    }
  } else {
    lines.push("_No comments on this ticket yet._");
  }

  return {
    ticket: ticket!,
    requester,
    comments,
    formatted: lines.join("\n"),
  };
}
