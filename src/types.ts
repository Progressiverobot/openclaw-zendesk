/**
 * Type definitions for the Zendesk channel plugin.
 */

// ---------------------------------------------------------------------------
// Raw config shapes (from openclaw.json channels.zendesk)
// ---------------------------------------------------------------------------

/** Raw per-account (or base) config for Zendesk */
export interface ZendeskAccountRaw {
  enabled?: boolean;
  /** Zendesk subdomain, e.g. "mycompany" → https://mycompany.zendesk.com */
  subdomain?: string;
  /** Agent email address used for API authentication */
  agentEmail?: string;
  /** Zendesk API token (not the agent password) */
  apiToken?: string;
  /**
   * Secret used to verify incoming webhook signatures
   * (Zendesk Webhook signing secret from the webhook definition).
   */
  webhookSecret?: string;
  /** The HTTP path where Zendesk will POST webhook events. Default: /webhook/zendesk */
  webhookPath?: string;
  /** Whether agent replies should be public (visible to the end-user). Default: true */
  publicReplies?: boolean;
  /** DM (ticket) policy: "open" | "allowlist" | "disabled". Default: "open" */
  dmPolicy?: "open" | "allowlist" | "disabled";
  /** List of allowed Zendesk user IDs (numeric strings) when dmPolicy="allowlist" */
  allowedUserIds?: string | string[];
  /** Requests per minute limit for inbound webhooks. Default: 60 */
  rateLimitPerMinute?: number;
}

/** Top-level channel config (may contain named accounts) */
export interface ZendeskChannelConfig extends ZendeskAccountRaw {
  accounts?: Record<string, ZendeskAccountRaw>;
}

// ---------------------------------------------------------------------------
// Resolved account (all defaults applied)
// ---------------------------------------------------------------------------

export interface ResolvedZendeskAccount {
  accountId: string;
  enabled: boolean;
  subdomain: string;
  agentEmail: string;
  apiToken: string;
  webhookSecret: string;
  webhookPath: string;
  publicReplies: boolean;
  dmPolicy: "open" | "allowlist" | "disabled";
  allowedUserIds: string[];
  rateLimitPerMinute: number;
}

// ---------------------------------------------------------------------------
// Zendesk REST API response shapes
// ---------------------------------------------------------------------------

export interface ZendeskUser {
  id: number;
  name: string;
  email: string;
  role: "end-user" | "agent" | "admin" | string;
  active: boolean;
  verified: boolean;
  organization_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  phone?: string | null;
  time_zone?: string;
  locale?: string;
  notes?: string;
  details?: string;
}

export interface ZendeskTicket {
  id: number;
  subject: string;
  description: string;
  status: "new" | "open" | "pending" | "hold" | "solved" | "closed";
  priority: "low" | "normal" | "high" | "urgent" | null;
  type: "problem" | "incident" | "question" | "task" | null;
  requester_id: number;
  submitter_id: number;
  assignee_id: number | null;
  group_id: number | null;
  organization_id: number | null;
  ticket_form_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  url?: string;
  via?: { channel: string; source?: Record<string, unknown> };
  custom_fields?: Array<{ id: number; value: unknown }>;
  satisfaction_rating?: { score: string; comment?: string } | null;
  sla_policy?: { id: number; title: string } | null;
}

export interface ZendeskComment {
  id: number;
  type: "Comment" | "VoiceComment";
  author_id: number;
  body: string;
  html_body: string;
  plain_body: string;
  public: boolean;
  created_at: string;
  attachments?: ZendeskAttachment[];
}

export interface ZendeskAttachment {
  id: number;
  file_name: string;
  content_url: string;
  content_type: string;
  size: number;
  thumbnails?: Array<{ id: number; file_name: string; content_url: string }>;
}

export interface ZendeskGroup {
  id: number;
  name: string;
  description?: string;
  default: boolean;
  deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ZendeskOrganization {
  id: number;
  name: string;
  domain_names: string[];
  tags: string[];
  notes?: string;
  details?: string;
  group_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ZendeskView {
  id: number;
  title: string;
  active: boolean;
  default: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  conditions?: {
    all?: Array<{ field: string; operator: string; value: string }>;
    any?: Array<{ field: string; operator: string; value: string }>;
  };
}

export interface ZendeskMacro {
  id: number;
  title: string;
  active: boolean;
  shared: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  actions?: Array<{ field: string; value: unknown }>;
}

export interface ZendeskTrigger {
  id: number;
  title: string;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  conditions?: {
    all?: Array<{ field: string; operator: string; value: string }>;
    any?: Array<{ field: string; operator: string; value: string }>;
  };
  actions?: Array<{ field: string; value: unknown }>;
}

export interface ZendeskAutomation {
  id: number;
  title: string;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  conditions?: {
    all?: Array<{ field: string; operator: string; value: string }>;
    any?: Array<{ field: string; operator: string; value: string }>;
  };
  actions?: Array<{ field: string; value: unknown }>;
}

export interface ZendeskSlaPolicy {
  id: number;
  title: string;
  description: string;
  position: number;
  policy_metrics?: Array<{
    priority: string;
    metric: string;
    target: number;
    business_hours: boolean;
  }>;
  created_at: string;
  updated_at: string;
}

export interface ZendeskSearchResult {
  results: Array<ZendeskTicket | ZendeskUser | ZendeskOrganization | Record<string, unknown>>;
  count: number;
  next_page: string | null;
  previous_page: string | null;
}

export interface ZendeskArticle {
  id: number;
  title: string;
  body: string;
  html_url: string;
  section_id: number;
  label_names: string[];
  locale: string;
  created_at: string;
  updated_at: string;
  author_id: number;
  draft: boolean;
  promoted: boolean;
  position: number;
  vote_sum: number;
  vote_count: number;
}

export interface ZendeskSection {
  id: number;
  name: string;
  description?: string;
  category_id: number;
  locale: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface ZendeskCategory {
  id: number;
  name: string;
  description?: string;
  locale: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface ZendeskSatisfactionRating {
  id: number;
  ticket_id: number;
  requester_id: number;
  assignee_id: number | null;
  group_id: number | null;
  score: "offered" | "unoffered" | "good" | "bad" | "good_with_comment" | "bad_with_comment";
  comment?: string;
  reason?: string;
  created_at: string;
  updated_at: string;
}

export interface ZendeskSuspendedTicket {
  id: number;
  url: string;
  subject: string;
  cause: string;
  cause_id: number;
  author?: { email: string; name: string };
  created_at: string;
  updated_at: string;
}

export interface ZendeskAuditLog {
  id: number;
  action_label: string;
  actor_id: number;
  actor_name: string;
  source_id: number;
  source_type: string;
  source_label: string;
  action: string;
  change_description: string;
  ip_address: string;
  created_at: string;
}

export interface ZendeskWebhookDef {
  id: string;
  name: string;
  endpoint: string;
  status: "active" | "inactive";
  http_method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  request_format: "json" | "xml" | "form_encoded";
  subscriptions: string[];
  authentication?: {
    type: string;
    data?: Record<string, unknown>;
    add_position?: string;
  };
  created_at: string;
  updated_at: string;
}

export interface ZendeskTicketMetric {
  id: number;
  ticket_id: number;
  created_at: string;
  updated_at: string;
  group_stations: number;
  assignee_stations: number;
  reopens: number;
  replies: number;
  assignee_updated_at: string | null;
  requester_updated_at: string | null;
  status?: {
    calendar?: number;
    business?: number;
  };
  initially_assigned_at?: string | null;
  assigned_at?: string | null;
  solved_at?: string | null;
  latest_comment_added_at?: string | null;
  first_resolution_time_in_minutes?: { calendar: number; business: number };
  reply_time_in_minutes?: { calendar: number; business: number };
  full_resolution_time_in_minutes?: { calendar: number; business: number };
  agent_wait_time_in_minutes?: { calendar: number; business: number };
  requester_wait_time_in_minutes?: { calendar: number; business: number };
}

// ---------------------------------------------------------------------------
// Inbound webhook payload
// ---------------------------------------------------------------------------

/**
 * Payload POSTed by a Zendesk webhook trigger.
 * The exact fields depend on the trigger's "Notify by → Webhook" template.
 * We use the default recommended template fields here.
 */
export interface ZendeskWebhookPayload {
  /** Zendesk ticket ID */
  ticket_id: number | string;
  /** Ticket subject */
  ticket_subject?: string;
  /** The comment body that triggered the webhook */
  message?: string;
  /** Zendesk user ID of the person who triggered this event */
  requester_id?: number | string;
  /** Human-readable name of the requester */
  requester_name?: string;
  /** Email of the requester */
  requester_email?: string;
  /** "new" | "open" | "pending" | … */
  ticket_status?: string;
  /** Webhook signing secret verification was done before this point */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Normalised inbound message (after parsing the webhook payload)
// ---------------------------------------------------------------------------

export interface ZendeskInboundMessage {
  ticketId: string;
  subject: string;
  body: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  ticketStatus: string;
}
