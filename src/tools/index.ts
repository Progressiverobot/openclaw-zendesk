/**
 * Zendesk agent tools – exposes every major Zendesk API operation as an
 * OpenClaw ChannelAgentTool so the AI agent can autonomously manage tickets,
 * users, organisations, views, macros, triggers, automations, SLA policies,
 * the Help Centre, and more – removing the need for a human to operate Zendesk.
 *
 * Built by Progressive Robot Ltd
 * https://www.progressiverobot.com
 *
 * Registration: add `agentTools: createZendeskAgentTools` to the ChannelPlugin.
 */

import { Type } from "@sinclair/typebox";
import type { ChannelAgentTool, ChannelAgentToolFactory } from "openclaw/plugin-sdk";
import { TtlCache } from "../cache.js";
import { resolveAccount } from "../accounts.js";
import * as ticketsApi from "../api/tickets.js";
import * as commentsApi from "../api/comments.js";
import * as usersApi from "../api/users.js";
import * as orgsApi from "../api/organizations.js";
import * as groupsApi from "../api/groups.js";
import * as viewsApi from "../api/views.js";
import * as macrosApi from "../api/macros.js";
import * as searchApi from "../api/search.js";
import * as hcApi from "../api/help-center.js";
import * as triggersApi from "../api/triggers.js";
import * as automationsApi from "../api/automations.js";
import * as slaApi from "../api/sla-policies.js";
import * as suspendedApi from "../api/suspended.js";
import * as attachmentsApi from "../api/attachments.js";
import * as satisfactionApi from "../api/satisfaction.js";
import * as auditApi from "../api/audit-logs.js";
import * as webhooksApiMod from "../api/webhooks-api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AgentToolResult = { content: Array<{ type: string; text: string }>; details?: unknown };

function ok(data: unknown): AgentToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: data };
}

function err(message: string): AgentToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }] };
}

function stringEnum<T extends readonly string[]>(values: T, description: string) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], description });
}

function optionalStringEnum<T extends readonly string[]>(values: T, description: string) {
  return Type.Optional(Type.Unsafe<T[number]>({ type: "string", enum: [...values], description }));
}

/**
 * Wrap a read-only tool with a short debounce cache.
 * Identical calls within `windowMs` return the cached result without a network
 * round-trip, preventing agent loops and redundant API hits.
 */
function debounceTool(tool: ChannelAgentTool, windowMs = 2_000): ChannelAgentTool {
  const cache = new TtlCache<string, AgentToolResult>(windowMs, 0);
  return {
    ...tool,
    execute: async (_id: string, params: unknown) => {
      const key = JSON.stringify(params);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const result = await tool.execute(_id, params as never);
      cache.set(key, result, windowMs);
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Tool factory – returns all tools, getting creds from config at call time
// ---------------------------------------------------------------------------

export const createZendeskAgentTools: ChannelAgentToolFactory = ({ cfg }) => {
  function getCreds() {
    const account = resolveAccount(cfg ?? {});
    return {
      subdomain: account.subdomain,
      agentEmail: account.agentEmail,
      apiToken: account.apiToken,
    };
  }

  // -------------------------------------------------------------------------
  // TICKET TOOLS
  // -------------------------------------------------------------------------

  const getTicket: ChannelAgentTool = {
    name: "zendesk_get_ticket",
    label: "Get Ticket",
    description: "Fetch a Zendesk ticket by ID, including all metadata (status, priority, tags, assignee, etc.).",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Zendesk ticket ID (numeric string)" }),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id }) => {
      const r = await ticketsApi.getTicket(getCreds(), ticket_id);
      return r.ok ? ok(r.ticket) : err(r.error);
    },
  };

  const listTickets: ChannelAgentTool = {
    name: "zendesk_list_tickets",
    label: "List Tickets",
    description: "List tickets from Zendesk with optional sorting and pagination.",
    parameters: Type.Object({
      page: Type.Optional(Type.Number({ description: "Page number (starts at 1)", minimum: 1 })),
      per_page: Type.Optional(Type.Number({ description: "Results per page (max 100)", minimum: 1, maximum: 100 })),
      sort_by: Type.Optional(Type.String({ description: "Field to sort by (e.g. created_at, updated_at)" })),
      sort_order: optionalStringEnum(["asc", "desc"] as const, "Sort direction"),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await ticketsApi.listTickets(getCreds(), {
        page: params.page,
        perPage: params.per_page,
        sortBy: params.sort_by,
        sortOrder: params.sort_order,
      });
      return r.ok ? ok({ tickets: r.tickets, count: r.count }) : err(r.error);
    },
  };

  const createTicket: ChannelAgentTool = {
    name: "zendesk_create_ticket",
    label: "Create Ticket",
    description: "Create a new Zendesk support ticket on behalf of a user or proactively.",
    parameters: Type.Object({
      subject: Type.String({ description: "Ticket subject line" }),
      body: Type.String({ description: "Initial comment / ticket description" }),
      requester_name: Type.Optional(Type.String({ description: "Name of the requester" })),
      requester_email: Type.Optional(Type.String({ description: "Email of the requester" })),
      status: optionalStringEnum(["new", "open", "pending", "solved"] as const, "Initial ticket status"),
      priority: optionalStringEnum(["low", "normal", "high", "urgent"] as const, "Ticket priority"),
      type: optionalStringEnum(["problem", "incident", "question", "task"] as const, "Ticket type"),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Tags to apply" })),
      assignee_id: Type.Optional(Type.Number({ description: "Agent user ID to assign to" })),
      group_id: Type.Optional(Type.Number({ description: "Group ID to assign to" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await ticketsApi.createTicket(getCreds(), {
        subject: params.subject,
        comment: { body: params.body, public: true },
        requester: params.requester_email
          ? { name: params.requester_name, email: params.requester_email }
          : undefined,
        status: params.status,
        priority: params.priority,
        type: params.type,
        tags: params.tags,
        assignee_id: params.assignee_id,
        group_id: params.group_id,
      });
      return r.ok ? ok(r.ticket) : err(r.error);
    },
  };

  const updateTicket: ChannelAgentTool = {
    name: "zendesk_update_ticket",
    label: "Update Ticket",
    description: "Update a Zendesk ticket's status, priority, assignee, group, subject, or tags.",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID to update" }),
      status: optionalStringEnum(["open", "pending", "hold", "solved", "closed"] as const, "New status"),
      priority: optionalStringEnum(["low", "normal", "high", "urgent"] as const, "New priority"),
      type: optionalStringEnum(["problem", "incident", "question", "task"] as const, "Ticket type"),
      subject: Type.Optional(Type.String({ description: "New subject line" })),
      assignee_id: Type.Optional(Type.Number({ description: "Agent user ID to assign (null to unassign)" })),
      group_id: Type.Optional(Type.Number({ description: "Group ID to assign" })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Replace all tags with these (use zendesk_add_ticket_tags to add without replacing)" })),
      comment: Type.Optional(Type.String({ description: "Optionally add a comment while updating" })),
      comment_public: Type.Optional(Type.Boolean({ description: "Whether the comment is public (default true)" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const updates: Parameters<typeof ticketsApi.updateTicket>[2] = {};
      if (params.status) updates.status = params.status;
      if (params.priority) updates.priority = params.priority;
      if (params.type) updates.type = params.type;
      if (params.subject) updates.subject = params.subject;
      if (params.assignee_id !== undefined) updates.assignee_id = params.assignee_id;
      if (params.group_id !== undefined) updates.group_id = params.group_id;
      if (params.tags) updates.tags = params.tags;
      if (params.comment) updates.comment = { body: params.comment, public: params.comment_public ?? true };
      const r = await ticketsApi.updateTicket(getCreds(), params.ticket_id, updates);
      return r.ok ? ok(r.ticket) : err(r.error);
    },
  };

  const solveTicket: ChannelAgentTool = {
    name: "zendesk_solve_ticket",
    label: "Solve Ticket",
    description: "Mark a ticket as solved, optionally adding a resolution comment.",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID to solve" }),
      resolution_comment: Type.Optional(Type.String({ description: "Public resolution message to the user" })),
      internal_note: Type.Optional(Type.String({ description: "Internal note for agents (not visible to user)" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const updates: Parameters<typeof ticketsApi.updateTicket>[2] = { status: "solved" };
      if (params.resolution_comment) {
        updates.comment = { body: params.resolution_comment, public: true };
      }
      const r = await ticketsApi.updateTicket(getCreds(), params.ticket_id, updates);
      if (!r.ok) return err(r.error);
      if (params.internal_note) {
        await commentsApi.addComment(getCreds(), params.ticket_id, params.internal_note, false);
      }
      return ok({ solved: true, ticket: r.ticket });
    },
  };

  const deleteTicket: ChannelAgentTool = {
    name: "zendesk_delete_ticket",
    label: "Delete Ticket",
    description: "Soft-delete a Zendesk ticket (moves to the deleted view). Use with caution.",
    ownerOnly: true,
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID to delete" }),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id }) => {
      const r = await ticketsApi.deleteTicket(getCreds(), ticket_id);
      return r.ok ? ok({ deleted: true, ticket_id }) : err(r.error);
    },
  };

  const mergeTickets: ChannelAgentTool = {
    name: "zendesk_merge_tickets",
    label: "Merge Tickets",
    description: "Merge one or more source tickets into a target ticket.",
    parameters: Type.Object({
      target_id: Type.String({ description: "The ticket ID to merge into (kept open)" }),
      source_ids: Type.Array(Type.String(), { description: "Ticket IDs to merge (will be closed)" }),
      target_comment: Type.Optional(Type.String({ description: "Comment added to the target ticket" })),
      source_comment: Type.Optional(Type.String({ description: "Comment added to each source ticket" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await ticketsApi.mergeTickets(getCreds(), params.target_id, params.source_ids, {
        targetComment: params.target_comment,
        sourceComment: params.source_comment,
      });
      return r.ok ? ok({ merged: true, jobStatus: r.jobStatus }) : err(r.error);
    },
  };

  const bulkUpdateTickets: ChannelAgentTool = {
    name: "zendesk_bulk_update_tickets",
    label: "Bulk Update Tickets",
    description: "Update status, priority, assignee, or group across up to 100 tickets at once.",
    parameters: Type.Object({
      ticket_ids: Type.Array(Type.String(), { description: "Ticket IDs to update (max 100)" }),
      status: optionalStringEnum(["open", "pending", "hold", "solved", "closed"] as const, "New status for all tickets"),
      priority: optionalStringEnum(["low", "normal", "high", "urgent"] as const, "New priority"),
      assignee_id: Type.Optional(Type.Number({ description: "Assign all tickets to this agent ID" })),
      group_id: Type.Optional(Type.Number({ description: "Move all tickets to this group" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await ticketsApi.bulkUpdateTickets(getCreds(), params.ticket_ids, {
        status: params.status,
        priority: params.priority,
        assignee_id: params.assignee_id,
        group_id: params.group_id,
      });
      return r.ok ? ok({ updated: true, jobStatus: r.jobStatus }) : err(r.error);
    },
  };

  const setTicketTags: ChannelAgentTool = {
    name: "zendesk_set_ticket_tags",
    label: "Set Ticket Tags",
    description: "Replace all tags on a ticket with the provided list.",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID" }),
      tags: Type.Array(Type.String(), { description: "Complete list of tags to set" }),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id, tags }) => {
      const r = await ticketsApi.setTicketTags(getCreds(), ticket_id, tags);
      return r.ok ? ok({ tags: r.tags }) : err(r.error);
    },
  };

  const addTicketTags: ChannelAgentTool = {
    name: "zendesk_add_ticket_tags",
    label: "Add Ticket Tags",
    description: "Add tags to a ticket without removing existing ones.",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID" }),
      tags: Type.Array(Type.String(), { description: "Tags to add" }),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id, tags }) => {
      const r = await ticketsApi.addTicketTags(getCreds(), ticket_id, tags);
      return r.ok ? ok({ tags: r.tags }) : err(r.error);
    },
  };

  const removeTicketTags: ChannelAgentTool = {
    name: "zendesk_remove_ticket_tags",
    label: "Remove Ticket Tags",
    description: "Remove specific tags from a ticket without affecting any other tags.",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID" }),
      tags: Type.Array(Type.String(), { description: "Tags to remove" }),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id, tags }) => {
      const r = await ticketsApi.removeTicketTags(getCreds(), ticket_id, tags);
      return r.ok ? ok({ removed: true, tags }) : err(r.error);
    },
  };

  const skipTicket: ChannelAgentTool = {
    name: "zendesk_skip_ticket",
    label: "Skip Ticket",
    description: "Skip a ticket in round-robin play, optionally providing a reason.",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID to skip" }),
      reason: Type.Optional(Type.String({ description: "Reason for skipping" })),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id, reason }) => {
      const r = await ticketsApi.skipTicket(getCreds(), ticket_id, reason);
      return r.ok ? ok({ skipped: true }) : err(r.error);
    },
  };

  const getTicketMetrics: ChannelAgentTool = {
    name: "zendesk_get_ticket_metrics",
    label: "Get Ticket Metrics",
    description: "Fetch timing and performance metrics for a ticket (reply time, resolution time, reopens, etc.).",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID" }),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id }) => {
      const r = await ticketsApi.getTicketMetrics(getCreds(), ticket_id);
      return r.ok ? ok(r.metric) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // COMMENT TOOLS
  // -------------------------------------------------------------------------

  const addComment: ChannelAgentTool = {
    name: "zendesk_add_comment",
    label: "Add Comment",
    description: "Add a public reply or internal note to a Zendesk ticket.",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID to comment on" }),
      body: Type.String({ description: "Comment body text (Markdown supported)" }),
      public: Type.Optional(Type.Boolean({ description: "True = public reply to user; false = internal note (default: true)" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await commentsApi.addComment(getCreds(), params.ticket_id, params.body, params.public ?? true);
      return r.ok ? ok({ commented: true }) : err(r.error);
    },
  };

  const addInternalNote: ChannelAgentTool = {
    name: "zendesk_add_internal_note",
    label: "Add Internal Note",
    description: "Add a private internal note to a ticket (not visible to the end user).",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID" }),
      body: Type.String({ description: "Internal note content" }),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id, body }) => {
      const r = await commentsApi.addComment(getCreds(), ticket_id, body, false);
      return r.ok ? ok({ noted: true }) : err(r.error);
    },
  };

  const listComments: ChannelAgentTool = {
    name: "zendesk_list_comments",
    label: "List Comments",
    description: "List all comments on a ticket (full conversation history).",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID" }),
      max: Type.Optional(Type.Number({ description: "Maximum number of comments to return (default 50)", minimum: 1, maximum: 200 })),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id, max }) => {
      const r = await commentsApi.listAllComments(getCreds(), ticket_id, max ?? 50);
      return r.ok ? ok({ comments: r.comments, count: r.comments.length }) : err(r.error);
    },
  };

  const redactComment: ChannelAgentTool = {
    name: "zendesk_redact_comment",
    label: "Redact Comment Text",
    description: "Permanently redact a specific string from a comment (irreversible).",
    ownerOnly: true,
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID" }),
      comment_id: Type.String({ description: "Comment ID" }),
      text: Type.String({ description: "Exact text string to redact" }),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id, comment_id, text }) => {
      const r = await commentsApi.redactCommentString(getCreds(), ticket_id, comment_id, text);
      return r.ok ? ok({ redacted: true }) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // USER TOOLS
  // -------------------------------------------------------------------------

  const getUser: ChannelAgentTool = {
    name: "zendesk_get_user",
    label: "Get User",
    description: "Fetch a Zendesk user by their ID.",
    parameters: Type.Object({
      user_id: Type.String({ description: "Zendesk user ID" }),
    }, { additionalProperties: false }),
    execute: async (_id, { user_id }) => {
      const r = await usersApi.getUser(getCreds(), user_id);
      return r.ok ? ok(r.user) : err(r.error);
    },
  };

  const searchUsers: ChannelAgentTool = {
    name: "zendesk_search_users",
    label: "Search Users",
    description: "Search Zendesk users by name, email, or other fields.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query, e.g. email:foo@bar.com or name:John" }),
    }, { additionalProperties: false }),
    execute: async (_id, { query }) => {
      const r = await usersApi.searchUsers(getCreds(), query);
      return r.ok ? ok({ users: r.users, count: r.count }) : err(r.error);
    },
  };

  const createUser: ChannelAgentTool = {
    name: "zendesk_create_user",
    label: "Create User",
    description: "Create a new Zendesk end-user or agent.",
    parameters: Type.Object({
      name: Type.String({ description: "User's display name" }),
      email: Type.Optional(Type.String({ description: "User's email address" })),
      role: optionalStringEnum(["end-user", "agent", "admin"] as const, "User role (default: end-user)"),
      phone: Type.Optional(Type.String({ description: "Phone number" })),
      notes: Type.Optional(Type.String({ description: "Internal notes about this user" })),
      organization_id: Type.Optional(Type.Number({ description: "Org to add the user to" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await usersApi.createUser(getCreds(), {
        name: params.name,
        email: params.email,
        role: params.role,
        phone: params.phone,
        notes: params.notes,
        organization_id: params.organization_id,
      });
      return r.ok ? ok(r.user) : err(r.error);
    },
  };

  const updateUser: ChannelAgentTool = {
    name: "zendesk_update_user",
    label: "Update User",
    description: "Update a Zendesk user's name, email, role, phone, notes, or organization.",
    parameters: Type.Object({
      user_id: Type.String({ description: "User ID to update" }),
      name: Type.Optional(Type.String({ description: "New display name" })),
      email: Type.Optional(Type.String({ description: "New email" })),
      role: optionalStringEnum(["end-user", "agent", "admin"] as const, "New role"),
      phone: Type.Optional(Type.String({ description: "Phone number" })),
      notes: Type.Optional(Type.String({ description: "Internal notes" })),
      organization_id: Type.Optional(Type.Number({ description: "Move to this org ID" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const { user_id, ...updates } = params;
      const r = await usersApi.updateUser(getCreds(), user_id, updates);
      return r.ok ? ok(r.user) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // ORGANISATION TOOLS
  // -------------------------------------------------------------------------

  const getOrganization: ChannelAgentTool = {
    name: "zendesk_get_organization",
    label: "Get Organization",
    description: "Fetch a Zendesk organization by ID.",
    parameters: Type.Object({
      org_id: Type.String({ description: "Organization ID" }),
    }, { additionalProperties: false }),
    execute: async (_id, { org_id }) => {
      const r = await orgsApi.getOrganization(getCreds(), org_id);
      return r.ok ? ok(r.organization) : err(r.error);
    },
  };

  const listOrganizations: ChannelAgentTool = {
    name: "zendesk_list_organizations",
    label: "List Organizations",
    description: "List all organizations in Zendesk.",
    parameters: Type.Object({
      page: Type.Optional(Type.Number({ minimum: 1 })),
    }, { additionalProperties: false }),
    execute: async (_id, { page }) => {
      const r = await orgsApi.listOrganizations(getCreds(), { page });
      return r.ok ? ok({ organizations: r.organizations, count: r.count }) : err(r.error);
    },
  };

  const createOrganization: ChannelAgentTool = {
    name: "zendesk_create_organization",
    label: "Create Organization",
    description: "Create a new organization in Zendesk.",
    parameters: Type.Object({
      name: Type.String({ description: "Organization name" }),
      domain_names: Type.Optional(Type.Array(Type.String(), { description: "Email domain names for auto-membership" })),
      tags: Type.Optional(Type.Array(Type.String())),
      notes: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await orgsApi.createOrganization(getCreds(), params);
      return r.ok ? ok(r.organization) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // GROUP TOOLS
  // -------------------------------------------------------------------------

  const listGroups: ChannelAgentTool = {
    name: "zendesk_list_groups",
    label: "List Groups",
    description: "List all agent groups in Zendesk.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      const r = await groupsApi.listGroups(getCreds());
      return r.ok ? ok({ groups: r.groups }) : err(r.error);
    },
  };

  const createGroup: ChannelAgentTool = {
    name: "zendesk_create_group",
    label: "Create Group",
    description: "Create a new agent group in Zendesk.",
    parameters: Type.Object({
      name: Type.String({ description: "Group name" }),
      description: Type.Optional(Type.String({ description: "Group description" })),
    }, { additionalProperties: false }),
    execute: async (_id, { name, description }) => {
      const r = await groupsApi.createGroup(getCreds(), name, description);
      return r.ok ? ok(r.group) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // VIEW TOOLS
  // -------------------------------------------------------------------------

  const listViews: ChannelAgentTool = {
    name: "zendesk_list_views",
    label: "List Views",
    description: "List active ticket views in Zendesk. Views are saved ticket filters agents use to manage queues.",
    parameters: Type.Object({
      active_only: Type.Optional(Type.Boolean({ description: "Only return active views (default true)" })),
    }, { additionalProperties: false }),
    execute: async (_id, { active_only }) => {
      const r = await viewsApi.listViews(getCreds(), active_only ?? true);
      return r.ok ? ok({ views: r.views }) : err(r.error);
    },
  };

  const executeView: ChannelAgentTool = {
    name: "zendesk_execute_view",
    label: "Execute View",
    description: "Fetch the tickets currently matching a specific Zendesk view.",
    parameters: Type.Object({
      view_id: Type.String({ description: "View ID to execute" }),
      page: Type.Optional(Type.Number({ minimum: 1 })),
      per_page: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
      sort_by: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await viewsApi.executeView(getCreds(), params.view_id, {
        page: params.page,
        perPage: params.per_page,
        sortBy: params.sort_by,
      });
      return r.ok ? ok({ tickets: r.tickets, count: r.count }) : err(r.error);
    },
  };

  const countViewTickets: ChannelAgentTool = {
    name: "zendesk_count_view_tickets",
    label: "Count View Tickets",
    description: "Get the number of tickets in a view without fetching them all.",
    parameters: Type.Object({
      view_id: Type.String({ description: "View ID" }),
    }, { additionalProperties: false }),
    execute: async (_id, { view_id }) => {
      const r = await viewsApi.countViewTickets(getCreds(), view_id);
      return r.ok ? ok({ count: r.count, fresh: r.fresh }) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // MACRO TOOLS
  // -------------------------------------------------------------------------

  const listMacros: ChannelAgentTool = {
    name: "zendesk_list_macros",
    label: "List Macros",
    description: "List available Zendesk macros (saved ticket actions).",
    parameters: Type.Object({
      active_only: Type.Optional(Type.Boolean({ description: "Only return active macros (default true)" })),
    }, { additionalProperties: false }),
    execute: async (_id, { active_only }) => {
      const r = await macrosApi.listMacros(getCreds(), { active: active_only ?? true });
      return r.ok ? ok({ macros: r.macros }) : err(r.error);
    },
  };

  const applyMacro: ChannelAgentTool = {
    name: "zendesk_apply_macro",
    label: "Apply Macro",
    description: "Apply a macro to a ticket, executing its predefined actions (status change, comment, tags, etc.).",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID to apply the macro to" }),
      macro_id: Type.String({ description: "Macro ID to apply" }),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id, macro_id }) => {
      const r = await macrosApi.applyMacro(getCreds(), ticket_id, macro_id);
      return r.ok ? ok({ applied: true, ticket: r.ticket }) : err(r.error);
    },
  };

  const searchMacros: ChannelAgentTool = {
    name: "zendesk_search_macros",
    label: "Search Macros",
    description: "Search macros by title keyword.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }, { additionalProperties: false }),
    execute: async (_id, { query }) => {
      const r = await macrosApi.searchMacros(getCreds(), query);
      return r.ok ? ok({ macros: r.macros }) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // SEARCH TOOLS
  // -------------------------------------------------------------------------

  const searchZendesk: ChannelAgentTool = {
    name: "zendesk_search",
    label: "Search Zendesk",
    description: `Search across all Zendesk resources using the unified search API.
Query syntax examples:
  - type:ticket status:open priority:urgent
  - type:ticket subject:refund created>2024-01-01
  - type:user email:customer@example.com
  - type:organization name:Acme`,
    parameters: Type.Object({
      query: Type.String({ description: "Zendesk search query" }),
      page: Type.Optional(Type.Number({ minimum: 1 })),
      per_page: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
      sort_by: Type.Optional(Type.String({ description: "Field to sort by" })),
      sort_order: optionalStringEnum(["asc", "desc"] as const, "Sort direction"),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await searchApi.search(getCreds(), params.query, {
        page: params.page,
        perPage: params.per_page,
        sortBy: params.sort_by,
        sortOrder: params.sort_order,
      });
      return r.ok ? ok({ results: r.results, count: r.count }) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // HELP CENTRE TOOLS
  // -------------------------------------------------------------------------

  const searchKnowledgeBase: ChannelAgentTool = {
    name: "zendesk_search_kb",
    label: "Search Knowledge Base",
    description: "Search the Zendesk Help Centre / knowledge base for articles relevant to a topic.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      locale: Type.Optional(Type.String({ description: "Locale code (default: en-us)" })),
    }, { additionalProperties: false }),
    execute: async (_id, { query, locale }) => {
      const r = await hcApi.searchArticles(getCreds(), query, { locale });
      return r.ok ? ok({ articles: r.articles, count: r.count }) : err(r.error);
    },
  };

  const getArticle: ChannelAgentTool = {
    name: "zendesk_get_article",
    label: "Get KB Article",
    description: "Fetch the full content of a Help Centre article by ID.",
    parameters: Type.Object({
      article_id: Type.String({ description: "Article ID" }),
      locale: Type.Optional(Type.String({ description: "Locale (default: en-us)" })),
    }, { additionalProperties: false }),
    execute: async (_id, { article_id, locale }) => {
      const r = await hcApi.getArticle(getCreds(), article_id, locale ?? "en-us");
      return r.ok ? ok(r.article) : err(r.error);
    },
  };

  const listArticles: ChannelAgentTool = {
    name: "zendesk_list_articles",
    label: "List KB Articles",
    description: "List Help Centre articles, optionally filtered by section.",
    parameters: Type.Object({
      section_id: Type.Optional(Type.String({ description: "Section ID to filter by" })),
      locale: Type.Optional(Type.String({ description: "Locale code" })),
      page: Type.Optional(Type.Number({ minimum: 1 })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await hcApi.listArticles(getCreds(), {
        sectionId: params.section_id,
        locale: params.locale,
        page: params.page,
      });
      return r.ok ? ok({ articles: r.articles, count: r.count }) : err(r.error);
    },
  };

  const createArticle: ChannelAgentTool = {
    name: "zendesk_create_article",
    label: "Create KB Article",
    description: "Create a new Help Centre article in a given section.",
    parameters: Type.Object({
      section_id: Type.String({ description: "Section ID to create the article in" }),
      title: Type.String({ description: "Article title" }),
      body: Type.String({ description: "Article body HTML or Markdown" }),
      draft: Type.Optional(Type.Boolean({ description: "Create as draft (default false)" })),
      promoted: Type.Optional(Type.Boolean({ description: "Pin/promote the article" })),
      locale: Type.Optional(Type.String({ description: "Locale (default en-us)" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await hcApi.createArticle(getCreds(), params.section_id, {
        title: params.title,
        body: params.body,
        draft: params.draft,
        promoted: params.promoted,
        locale: params.locale,
      });
      return r.ok ? ok(r.article) : err(r.error);
    },
  };

  const updateArticle: ChannelAgentTool = {
    name: "zendesk_update_article",
    label: "Update KB Article",
    description: "Update the title, body, draft status, or promotion of a Help Centre article.",
    parameters: Type.Object({
      article_id: Type.String({ description: "Article ID to update" }),
      title: Type.Optional(Type.String({ description: "New title" })),
      body: Type.Optional(Type.String({ description: "New body content" })),
      draft: Type.Optional(Type.Boolean({ description: "Set draft status" })),
      promoted: Type.Optional(Type.Boolean({ description: "Set promoted/pinned status" })),
      locale: Type.Optional(Type.String({ description: "Locale" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const { article_id, locale, ...updates } = params;
      const r = await hcApi.updateArticle(getCreds(), article_id, updates, locale ?? "en-us");
      return r.ok ? ok(r.article) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // TRIGGER / AUTOMATION TOOLS
  // -------------------------------------------------------------------------

  const listTriggers: ChannelAgentTool = {
    name: "zendesk_list_triggers",
    label: "List Triggers",
    description: "List Zendesk ticket triggers (event-based business rules).",
    parameters: Type.Object({
      active_only: Type.Optional(Type.Boolean({ description: "Only return active triggers (default true)" })),
    }, { additionalProperties: false }),
    execute: async (_id, { active_only }) => {
      const r = await triggersApi.listTriggers(getCreds(), { active: active_only ?? true });
      return r.ok ? ok({ triggers: r.triggers }) : err(r.error);
    },
  };

  const listAutomations: ChannelAgentTool = {
    name: "zendesk_list_automations",
    label: "List Automations",
    description: "List Zendesk automations (time-based business rules).",
    parameters: Type.Object({
      active_only: Type.Optional(Type.Boolean({ description: "Only return active automations" })),
    }, { additionalProperties: false }),
    execute: async (_id, { active_only }) => {
      const r = await automationsApi.listAutomations(getCreds(), { active: active_only ?? true });
      return r.ok ? ok({ automations: r.automations }) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // SLA TOOLS
  // -------------------------------------------------------------------------

  const listSlaPolicies: ChannelAgentTool = {
    name: "zendesk_list_sla_policies",
    label: "List SLA Policies",
    description: "List all SLA policies, including targets for first-reply, resolution, and other metrics.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      const r = await slaApi.listSlaPolicies(getCreds());
      return r.ok ? ok({ slaPolicies: r.slaPolicies }) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // SUSPENDED TICKET TOOLS
  // -------------------------------------------------------------------------

  const listSuspendedTickets: ChannelAgentTool = {
    name: "zendesk_list_suspended_tickets",
    label: "List Suspended Tickets",
    description: "List tickets in the suspended queue (spam/blocked). These can be recovered or deleted.",
    parameters: Type.Object({
      page: Type.Optional(Type.Number({ minimum: 1 })),
    }, { additionalProperties: false }),
    execute: async (_id, { page }) => {
      const r = await suspendedApi.listSuspendedTickets(getCreds(), { page });
      return r.ok ? ok({ suspendedTickets: r.suspendedTickets, count: r.count }) : err(r.error);
    },
  };

  const recoverSuspendedTicket: ChannelAgentTool = {
    name: "zendesk_recover_suspended_ticket",
    label: "Recover Suspended Ticket",
    description: "Recover a suspended ticket, creating a live ticket from it.",
    parameters: Type.Object({
      suspended_id: Type.String({ description: "Suspended ticket ID to recover" }),
    }, { additionalProperties: false }),
    execute: async (_id, { suspended_id }) => {
      const r = await suspendedApi.recoverSuspendedTicket(getCreds(), suspended_id);
      return r.ok ? ok({ recovered: true, ticket: r.ticket }) : err(r.error);
    },
  };

  const deleteSuspendedTicket: ChannelAgentTool = {
    name: "zendesk_delete_suspended_ticket",
    label: "Delete Suspended Ticket",
    description: "Permanently delete a ticket from the suspended queue (spam removal).",
    parameters: Type.Object({
      suspended_id: Type.String({ description: "Suspended ticket ID to delete" }),
    }, { additionalProperties: false }),
    execute: async (_id, { suspended_id }) => {
      const r = await suspendedApi.deleteSuspendedTicket(getCreds(), suspended_id);
      return r.ok ? ok({ deleted: true }) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // SATISFACTION TOOLS
  // -------------------------------------------------------------------------

  const listSatisfactionRatings: ChannelAgentTool = {
    name: "zendesk_list_satisfaction_ratings",
    label: "List Satisfaction Ratings",
    description: "List customer satisfaction ratings (CSAT), optionally filtered by score or date range.",
    parameters: Type.Object({
      score: optionalStringEnum(
        ["good", "bad", "good_with_comment", "bad_with_comment", "offered", "unoffered"] as const,
        "Filter by score",
      ),
      start_time: Type.Optional(Type.String({ description: "ISO 8601 start date (e.g. 2024-01-01T00:00:00Z)" })),
      end_time: Type.Optional(Type.String({ description: "ISO 8601 end date" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await satisfactionApi.listSatisfactionRatings(getCreds(), {
        score: params.score,
        startTime: params.start_time,
        endTime: params.end_time,
      });
      return r.ok ? ok({ ratings: r.ratings, count: r.count }) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // AUDIT LOG TOOLS
  // -------------------------------------------------------------------------

  const listAuditLogs: ChannelAgentTool = {
    name: "zendesk_list_audit_logs",
    label: "List Audit Logs",
    description: "List Zendesk audit logs to track changes, logins, and admin actions.",
    ownerOnly: true,
    parameters: Type.Object({
      source_type: Type.Optional(Type.String({ description: "Filter by source type, e.g. user, ticket" })),
      action: Type.Optional(Type.String({ description: "Filter by action, e.g. update, create, destroy" })),
      created_at: Type.Optional(Type.String({ description: "Filter entries after this ISO 8601 date" })),
      page: Type.Optional(Type.Number({ minimum: 1 })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await auditApi.listAuditLogs(getCreds(), {
        filter: {
          sourceType: params.source_type,
          action: params.action,
          createdAt: params.created_at,
        },
        page: params.page,
      });
      return r.ok ? ok({ auditLogs: r.auditLogs, count: r.count }) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // ESCALATION TOOL
  // -------------------------------------------------------------------------

  const escalateToHuman: ChannelAgentTool = {
    name: "zendesk_escalate_to_human",
    label: "Escalate to Human Agent",
    description: `Hand off a ticket to a human agent when autonomous resolution is not possible.
Adds a private escalation note, applies the "needs-human" and "ai-escalated" tags, sets the
ticket to open, and optionally moves it to a specific human-staffed group.

Use this when:
- The KB has no solution for the problem
- The customer explicitly requests a human
- The action requires manager approval or a refund override
- The complexity or sensitivity is beyond AI capability`,
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID to escalate" }),
      reason: Type.String({ description: "Specific reason why this ticket requires a human agent" }),
      group_id: Type.Optional(Type.Number({ description: "Human agent group to assign to (optional)" })),
      priority: optionalStringEnum(["low", "normal", "high", "urgent"] as const, "Escalation priority (optional; keeps current priority if omitted)"),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const creds = getCreds();
      // Step 1: add private escalation note
      const noteBody = `🔔 **Escalated to human agent**\n\nReason: ${params.reason}`;
      const noteResult = await commentsApi.addComment(creds, params.ticket_id, noteBody, false);
      if (!noteResult.ok) return err(noteResult.error);
      // Step 2: apply escalation tags
      const tagResult = await ticketsApi.addTicketTags(creds, params.ticket_id, ["needs-human", "ai-escalated"]);
      if (!tagResult.ok) return err(tagResult.error);
      // Step 3: update ticket status (and optionally group/priority)
      const updates: Parameters<typeof ticketsApi.updateTicket>[2] = { status: "open" };
      if (params.group_id !== undefined) updates.group_id = params.group_id;
      if (params.priority) updates.priority = params.priority as typeof updates.priority;
      const r = await ticketsApi.updateTicket(creds, params.ticket_id, updates);
      return r.ok ? ok({ escalated: true, ticket: r.ticket }) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // WEBHOOK MANAGEMENT TOOLS
  // -------------------------------------------------------------------------

  const listWebhooks: ChannelAgentTool = {
    name: "zendesk_list_webhooks",
    label: "List Webhooks",
    description: "List all Zendesk webhook definitions.",
    ownerOnly: true,
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      const r = await webhooksApiMod.listWebhooks(getCreds());
      return r.ok ? ok({ webhooks: r.webhooks }) : err(r.error);
    },
  };

  const createWebhook: ChannelAgentTool = {
    name: "zendesk_create_webhook",
    label: "Create Webhook",
    description: "Create a new Zendesk webhook definition.",
    ownerOnly: true,
    parameters: Type.Object({
      name: Type.String({ description: "Webhook name" }),
      endpoint: Type.String({ description: "HTTPS endpoint URL to receive events" }),
      http_method: stringEnum(["POST", "GET", "PUT", "PATCH", "DELETE"] as const, "HTTP method"),
      subscriptions: Type.Array(Type.String(), { description: "Event subscriptions, e.g. [\"conditional_ticket_events\"]" }),
      status: stringEnum(["active", "inactive"] as const, "Webhook status"),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      const r = await webhooksApiMod.createWebhook(getCreds(), {
        name: params.name,
        endpoint: params.endpoint,
        http_method: params.http_method,
        request_format: "json",
        status: params.status,
        subscriptions: params.subscriptions,
      });
      return r.ok ? ok(r.webhook) : err(r.error);
    },
  };

  // -------------------------------------------------------------------------
  // ATTACHMENT TOOLS
  // -------------------------------------------------------------------------

  const listTicketAttachments: ChannelAgentTool = {
    name: "zendesk_list_ticket_attachments",
    label: "List Ticket Attachments",
    description: "List all attachments across all comments on a ticket.",
    parameters: Type.Object({
      ticket_id: Type.String({ description: "Ticket ID" }),
    }, { additionalProperties: false }),
    execute: async (_id, { ticket_id }) => {
      const r = await commentsApi.listAllComments(getCreds(), ticket_id);
      if (!r.ok) return err(r.error);
      const attachments = r.comments.flatMap((c) => c.attachments ?? []);
      return ok({ attachments, count: attachments.length });
    },
  };

  // -------------------------------------------------------------------------
  // Return all tools
  // -------------------------------------------------------------------------

  return [
    // Tickets (reads debounced; mutations pass through)
    debounceTool(getTicket),
    debounceTool(listTickets),
    createTicket,
    updateTicket,
    solveTicket,
    deleteTicket,
    mergeTickets,
    bulkUpdateTickets,
    setTicketTags,
    addTicketTags,
    removeTicketTags,
    skipTicket,
    debounceTool(getTicketMetrics),
    escalateToHuman,
    // Comments

    addComment,
    addInternalNote,
    debounceTool(listComments),
    redactComment,
    debounceTool(listTicketAttachments),
    // Users
    debounceTool(getUser),
    debounceTool(searchUsers),
    createUser,
    updateUser,
    // Organizations
    debounceTool(getOrganization),
    debounceTool(listOrganizations),
    createOrganization,
    // Groups
    debounceTool(listGroups),
    createGroup,
    // Views
    debounceTool(listViews),
    debounceTool(executeView),
    debounceTool(countViewTickets),
    // Macros
    debounceTool(listMacros),
    applyMacro,
    debounceTool(searchMacros),
    // Search
    debounceTool(searchZendesk),
    // Help Centre
    debounceTool(searchKnowledgeBase),
    debounceTool(getArticle),
    debounceTool(listArticles),
    createArticle,
    updateArticle,
    // Triggers & Automations
    debounceTool(listTriggers),
    debounceTool(listAutomations),
    // SLA
    debounceTool(listSlaPolicies),
    // Suspended tickets
    debounceTool(listSuspendedTickets),
    recoverSuspendedTicket,
    deleteSuspendedTicket,
    // Satisfaction
    debounceTool(listSatisfactionRatings),
    // Audit logs
    debounceTool(listAuditLogs),
    // Webhooks
    debounceTool(listWebhooks),
    createWebhook,
  ];
};
