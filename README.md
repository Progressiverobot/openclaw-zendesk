# OpenClaw Zendesk Module

> **Built by [Progressive Robot Ltd](https://progressiverobot.com)**

Connect [OpenClaw](https://openclaw.ai) to [Zendesk Support](https://www.zendesk.com) and let your AI agent autonomously handle the entire ticket lifecycle — receiving new tickets, replying to customers, applying macros, managing views, updating users and organisations, writing knowledge-base articles, and much more — with no human agent required.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Zendesk Setup](#zendesk-setup)
- [Environment Variables](#environment-variables)
- [Architecture](#architecture)
- [API Coverage](#api-coverage)
- [Agent Tools Reference](#agent-tools-reference)
- [Autonomous Queue Processor](#autonomous-queue-processor)
- [Onboarding Wizard](#onboarding-wizard)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview

The OpenClaw Zendesk module is a fully autonomous support automation system. Once connected, the AI agent can:

- **Receive** inbound Zendesk tickets via secure webhook  
- **Reply** publicly or add private internal notes  
- **Solve, close, merge, and delete** tickets  
- **Manage users, organisations, groups, and views**  
- **Read and write** your Help Centre (knowledge base)  
- **Apply macros** for repeatable workflows  
- **Inspect SLA policies, triggers, and automations**  
- **Proactively poll** configured views and take action without any inbound webhook

This module gives OpenClaw access to every major Zendesk API endpoint, covering the full [Zendesk API Reference](https://developer.zendesk.com/api-reference).

---

## Features

| Category | Capabilities |
|---|---|
| **Tickets** | Create, read, update, solve, delete, merge, bulk-update, skip, get metrics |
| **Comments** | Public replies, internal notes, paginated history, redact sensitive text |
| **Users** | CRUD, search by email/name, create-or-update, identities, tags |
| **Organisations** | CRUD, search, member management, tags |
| **Groups** | List, create, update, delete, membership management |
| **Views** | List active views, execute (fetch tickets from view), count, CRUD |
| **Macros** | List, search, apply to ticket (preview + commit), CRUD |
| **Search** | Unified search across all resources, export for large result sets |
| **Help Centre** | Articles — CRUD, search, promote; Sections; Categories |
| **Triggers** | List, search, CRUD (event-based business rules) |
| **Automations** | List, CRUD (time-based business rules) |
| **SLA Policies** | List, CRUD, reorder |
| **Suspended Tickets** | List, recover, recover-many, delete, delete-many |
| **Satisfaction Ratings** | List with score/date filters |
| **Audit Logs** | List with source/actor/action filters |
| **Webhooks** | List, create, update, delete, test |
| **Attachments** | Upload files, delete uploads |
| **Queue Processor** | Auto-poll views, dispatch tickets into agent pipeline |

---

## Prerequisites

- **OpenClaw** installed and running (`npm install -g openclaw`)
- **Zendesk Support** account (Suite Team or above recommended for full API access)
- A Zendesk **agent email** and **API token** (not your login password)
- An HTTPS-reachable OpenClaw gateway for incoming webhook delivery

---

## Installation

### Option A – Install from npm (recommended)

```bash
openclaw install @openclaw/zendesk
```

### Option B – Install from local source

Clone this repository alongside your OpenClaw checkout:

```bash
git clone https://github.com/progressiverobot/openclaw-module-zendesk
cd openclaw-module-zendesk
npm install
```

Then register the local extension in your OpenClaw config:

```yaml
# ~/.openclaw/config.yaml
extensions:
  - /absolute/path/to/openclaw-module-zendesk
```

---

## Configuration

Add a `channels.zendesk` block to your OpenClaw config file (`~/.openclaw/config.yaml` or equivalent):

```yaml
channels:
  zendesk:
    enabled: true

    # --- Required ---
    subdomain: mycompany          # Your Zendesk subdomain (mycompany.zendesk.com)
    agentEmail: bot@mycompany.com # Agent email used for API calls and comments
    apiToken: "<your_api_token>"  # Zendesk API token (Admin → Apps & Integrations → API)

    # --- Inbound webhook ---
    webhookSecret: "<random_secret>"  # Must match the Zendesk webhook signing secret
    webhookPath: /webhooks/zendesk    # HTTP path OpenClaw will listen on

    # --- Outbound reply settings ---
    publicReplies: true               # true = visible to customer; false = internal note

    # --- Access control ---
    dmPolicy: open                    # open | allowlist | block
    allowedUserIds: []                # Zendesk user IDs allowed when dmPolicy=allowlist

    # --- Autonomous queue polling (optional) ---
    queueViewIds:                     # View IDs to poll proactively (numeric strings)
      - "12345678"
      - "87654321"
    queuePollIntervalMs: 30000        # Poll every 30 seconds (default)
```

### Multi-account support

To connect multiple Zendesk instances, use the `accounts` sub-key:

```yaml
channels:
  zendesk:
    accounts:
      acme:
        subdomain: acme-corp
        agentEmail: support-bot@acme.com
        apiToken: "<acme_api_token>"
        webhookSecret: "<acme_secret>"
        webhookPath: /webhooks/zendesk/acme
        publicReplies: true
        queueViewIds:
          - "11111111"

      widgets:
        subdomain: widgets-co
        agentEmail: bot@widgets.co
        apiToken: "<widgets_api_token>"
        webhookSecret: "<widgets_secret>"
        webhookPath: /webhooks/zendesk/widgets
        publicReplies: false
```

---

## Zendesk Setup

### 1. Generate an API Token

1. In Zendesk Admin, go to **Apps and Integrations → APIs → Zendesk API**
2. Enable **Token Access**
3. Click **Add API token**, copy the token, and save it in your config

### 2. Create a Webhook (for inbound tickets)

In Zendesk Admin → **Apps and Integrations → Webhooks → Create webhook**:

| Field | Value |
|---|---|
| **Endpoint URL** | `https://your-gateway-host/webhooks/zendesk` |
| **Request method** | POST |
| **Request format** | JSON |
| **Authentication** | Webhook Signing Secret (copy this value into `webhookSecret` in your config) |

### 3. Create a Trigger to fire the webhook

In Zendesk Admin → **Objects and Rules → Triggers → Add trigger**:

**Conditions (all):** Ticket is Created **OR** Ticket is Updated, Comment is Present

**Actions:** Notify active webhook → select the webhook you just created

**JSON Body** (paste this into the webhook body):

```json
{
  "ticketId": "{{ticket.id}}",
  "subject": "{{ticket.title}}",
  "status": "{{ticket.status}}",
  "priority": "{{ticket.priority}}",
  "body": "{{ticket.latest_comment_html}}",
  "requesterEmail": "{{ticket.requester.email}}",
  "requesterName": "{{ticket.requester.name}}",
  "requesterId": "{{ticket.requester.id}}",
  "assigneeEmail": "{{ticket.assignee.email}}",
  "groupName": "{{ticket.group.name}}",
  "tags": "{{ticket.tags}}"
}
```

> **Tip**: Add a condition `Current user is not (agent email)` to prevent the bot from triggering on its own comments (feedback loop prevention).

---

## Environment Variables

All configuration keys can alternatively be provided as environment variables:

| Variable | Config key equivalent |
|---|---|
| `ZENDESK_SUBDOMAIN` | `channels.zendesk.subdomain` |
| `ZENDESK_AGENT_EMAIL` | `channels.zendesk.agentEmail` |
| `ZENDESK_API_TOKEN` | `channels.zendesk.apiToken` |
| `ZENDESK_WEBHOOK_SECRET` | `channels.zendesk.webhookSecret` |
| `ZENDESK_WEBHOOK_PATH` | `channels.zendesk.webhookPath` |
| `ZENDESK_PUBLIC_REPLIES` | `channels.zendesk.publicReplies` |
| `ZENDESK_DM_POLICY` | `channels.zendesk.dmPolicy` |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Zendesk SaaS                                │
│                                                                  │
│  Customer  ──►  Ticket  ──►  Trigger  ──►  Webhook POST          │
│                                                 │                │
└─────────────────────────────────────────────────┼────────────────┘
                                                  │ HTTPS
┌─────────────────────────────────────────────────▼────────────────┐
│                   OpenClaw Gateway                               │
│                                                                  │
│  webhook-handler.ts                                              │
│    • Verify HMAC-SHA256 signature                                │
│    • Rate-limit check                                            │
│    • Parse JSON payload                                          │
│         │                                                        │
│         ▼                                                        │
│  channel.ts (deliver callback)                                   │
│    • buildTicketContext() — fetch full ticket history            │
│    • finalizeInboundContext()                                     │
│    • dispatchReplyWithBufferedBlockDispatcher()                   │
│         │                                                        │
│         ▼                                                        │
│  OpenClaw AI Agent  ◄──►  Agent Tools (src/tools/index.ts)       │
│    40+ tool calls available:                                     │
│      zendesk_update_ticket, zendesk_add_comment,                 │
│      zendesk_search, zendesk_search_kb, …                        │
│         │                                                        │
│         ▼                                                        │
│  outbound.sendText()  ──►  addTicketComment()  ──►  Zendesk API  │
│                                                                  │
│  queue-processor.ts (optional)                                   │
│    • Polls view IDs every N seconds                              │
│    • Deduplicates with in-memory TTL cache                       │
│    • Dispatches new tickets into agent pipeline above            │
└──────────────────────────────────────────────────────────────────┘
```

### Key source files

| File | Purpose |
|---|---|
| `index.ts` | Plugin entry point — registers the channel with OpenClaw |
| `src/channel.ts` | Full `ChannelPlugin` implementation |
| `src/tools/index.ts` | All 40+ `ChannelAgentTool` definitions |
| `src/api/` | Individual Zendesk API modules (tickets, users, etc.) |
| `src/api/base.ts` | Shared fetch, auth, rate-limit tracking, pagination |
| `src/webhook-handler.ts` | HMAC verification and webhook dispatch |
| `src/queue-processor.ts` | Proactive view-polling autonomous worker |
| `src/ticket-context.ts` | Builds enriched ticket context for the agent |
| `src/probe.ts` | Credential health check used by `openclaw channels status --probe` |
| `src/onboarding.ts` | Setup checks and onboarding wizard |
| `src/retry.ts` | Exponential back-off retry wrapper |
| `src/types.ts` | All Zendesk entity TypeScript types |

---

## API Coverage

The module covers the following [Zendesk API](https://developer.zendesk.com/api-reference) areas:

| API Area | Endpoints covered |
|---|---|
| Tickets | GET, POST, PUT (single + bulk), DELETE (single + bulk), merge, skip, metrics, satisfaction |
| Ticket Comments | List, add (public/private), redact, make private |
| Ticket Tags | GET, SET, ADD, REMOVE |
| Users | GET, LIST, SEARCH, CREATE, UPDATE, DELETE, create-or-update, identities, tags |
| Organizations | GET, LIST, SEARCH, CREATE, UPDATE, DELETE, members, tags |
| Groups | GET, LIST, LIST\_ASSIGNABLE, CREATE, UPDATE, DELETE, memberships |
| Views | GET, LIST, LIST\_ACTIVE, EXECUTE, COUNT, CREATE, UPDATE, DELETE |
| Macros | GET, LIST, SEARCH, APPLY, CREATE, UPDATE, DELETE |
| Search | Unified search, type-scoped helpers, cursor export |
| Help Centre Articles | GET, LIST, SEARCH, CREATE, UPDATE, DELETE |
| Help Centre Sections | LIST |
| Help Centre Categories | LIST |
| Triggers | GET, LIST, SEARCH, CREATE, UPDATE, DELETE |
| Automations | GET, LIST, CREATE, UPDATE, DELETE |
| SLA Policies | GET, LIST, CREATE, UPDATE, DELETE, REORDER |
| Suspended Tickets | GET, LIST, RECOVER (single + many), DELETE (single + many) |
| Satisfaction Ratings | GET, LIST (with filters) |
| Audit Logs | GET, LIST (with source/actor/action/IP filters) |
| Webhooks | GET, LIST, CREATE, UPDATE, DELETE, TEST |
| Attachments | UPLOAD, DELETE UPLOAD |

---

## Agent Tools Reference

The following tools are available to the OpenClaw agent when the Zendesk channel is connected. All tool calls are fully typed with [TypeBox](https://github.com/sinclairzx81/typebox) schemas.

### Ticket Tools

| Tool | Description |
|---|---|
| `zendesk_get_ticket` | Fetch a ticket by ID with all metadata |
| `zendesk_list_tickets` | List tickets with sorting and pagination |
| `zendesk_create_ticket` | Create a new support ticket |
| `zendesk_update_ticket` | Update status, priority, assignee, group, subject, tags |
| `zendesk_solve_ticket` | Mark as solved with optional resolution comment |
| `zendesk_delete_ticket` | Soft-delete a ticket *(owner only)* |
| `zendesk_merge_tickets` | Merge source tickets into a target |
| `zendesk_bulk_update_tickets` | Update up to 100 tickets at once |
| `zendesk_set_ticket_tags` | Replace all tags on a ticket |
| `zendesk_add_ticket_tags` | Add tags without removing existing ones |
| `zendesk_remove_ticket_tags` | Remove specific tags without affecting other tags |
| `zendesk_skip_ticket` | Skip a ticket in round-robin with optional reason |
| `zendesk_get_ticket_metrics` | Fetch timing/performance metrics for a ticket |
| `zendesk_escalate_to_human` | Hand off to a human agent — adds internal note, sets `needs-human` tag, marks open |

### Comment Tools

| Tool | Description |
|---|---|
| `zendesk_add_comment` | Add a public reply or internal note |
| `zendesk_add_internal_note` | Add a private note (not visible to customer) |
| `zendesk_list_comments` | List full conversation history |
| `zendesk_redact_comment` | Permanently redact text from a comment *(owner only)* |
| `zendesk_list_ticket_attachments` | List all attachments across the ticket |

### User Tools

| Tool | Description |
|---|---|
| `zendesk_get_user` | Fetch a user by ID |
| `zendesk_search_users` | Search by name, email, or query |
| `zendesk_create_user` | Create an end-user or agent |
| `zendesk_update_user` | Update user fields |

### Organisation & Group Tools

| Tool | Description |
|---|---|
| `zendesk_get_organization` | Fetch an org by ID |
| `zendesk_list_organizations` | List all orgs |
| `zendesk_create_organization` | Create a new org |
| `zendesk_list_groups` | List all agent groups |
| `zendesk_create_group` | Create a new group |

### View & Queue Tools

| Tool | Description |
|---|---|
| `zendesk_list_views` | List active ticket views |
| `zendesk_execute_view` | Fetch tickets matching a view |
| `zendesk_count_view_tickets` | Count tickets in a view |

### Macro Tools

| Tool | Description |
|---|---|
| `zendesk_list_macros` | List available macros |
| `zendesk_apply_macro` | Apply a macro to a ticket |
| `zendesk_search_macros` | Search macros by keyword |

### Search & Knowledge Base

| Tool | Description |
|---|---|
| `zendesk_search` | Unified search across all resources |
| `zendesk_search_kb` | Search Help Centre articles |
| `zendesk_get_article` | Fetch full article content |
| `zendesk_list_articles` | List articles in a section |
| `zendesk_create_article` | Create a new KB article |
| `zendesk_update_article` | Update an existing article |

### Operational Tools

| Tool | Description |
|---|---|
| `zendesk_list_triggers` | List event-based business rules |
| `zendesk_list_automations` | List time-based business rules |
| `zendesk_list_sla_policies` | List all SLA policies with targets |
| `zendesk_list_suspended_tickets` | List the suspended/spam queue |
| `zendesk_recover_suspended_ticket` | Recover a suspended ticket |
| `zendesk_delete_suspended_ticket` | Delete from the spam queue |
| `zendesk_list_satisfaction_ratings` | Query CSAT data |
| `zendesk_list_audit_logs` | Audit admin actions *(owner only)* |
| `zendesk_list_webhooks` | List webhook definitions *(owner only)* |
| `zendesk_create_webhook` | Create a new webhook *(owner only)* |

---

## Autonomous Queue Processor

Beyond responding to inbound webhook events, the module includes a proactive queue processor that can **independently find and handle tickets** — no customer message required.

### How it works

1. On gateway start, the queue processor reads `queueViewIds` from config
2. Every `queuePollIntervalMs` milliseconds, it calls [Execute View](https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#list-tickets-from-a-view) for each configured view
3. New tickets (not yet processed by this session) are deduplicated using an in-memory TTL cache
4. Each new ticket is enriched with full context (comments, requester, org) via `buildTicketContext`
5. The enriched ticket is dispatched into the OpenClaw agent pipeline as if it arrived via webhook
6. The agent can reply, solve, escalate, or take any other action using the full tool set

### Example configuration

```yaml
channels:
  zendesk:
    subdomain: mycompany
    agentEmail: bot@mycompany.com
    apiToken: "<token>"
    queueViewIds:
      - "360001234567"   # "Unassigned tickets" view
      - "360007654321"   # "Waiting for bot" view
    queuePollIntervalMs: 60000   # Check every 60 seconds
```

> The queue processor uses exponential back-off on errors (capped at 10 minutes) and stops cleanly when the OpenClaw gateway stops the account.

---

## Onboarding Wizard

Run the onboarding check at any time:

```bash
openclaw channels status zendesk          # Shows config status
openclaw channels status --probe zendesk  # Verifies API credentials live
```

The module checks:

- `subdomain`, `agentEmail`, `apiToken` are all present
- `webhookSecret` is set (warns if missing)
- `dmPolicy` is consistent with `allowedUserIds`

---

## Security

- **Webhook signatures**: Every inbound webhook is verified against an HMAC-SHA256 signature computed from `webhookSecret`. Requests with missing or invalid signatures are rejected with HTTP 401.
- **Rate limiting**: A configurable per-IP rate limiter blocks webhook flooding. Burst defaults to 20 requests with a 10-second window.
- **API token**: The Zendesk API token is used with HTTP Basic auth (`{email}/token:{apiToken}`) and never logged or exposed.
- **Owner-only tools**: Destructive or sensitive tools (`zendesk_delete_ticket`, `zendesk_redact_comment`, `zendesk_list_audit_logs`, webhook tools) are marked `ownerOnly: true` and require the caller to be an authorised account owner in OpenClaw.
- **No credentials in logs**: All log output is sanitised; API tokens and webhook secrets are not printed.

---

## Caching & Rate Limiting

The module implements four distinct layers of protection to keep API usage efficient and within Zendesk's limits.

### Layer 1 — API response cache (`TtlCache`)

All GET calls made via `zdFetchCached()` in `src/api/base.ts` are stored in a module-level `TtlCache` with a **30-second TTL**. A concurrent `InflightCache` collapses duplicate in-flight requests for the same URL into a single network call, preventing thundering-herd problems during rapid agent iteration.

```
zdFetchCached(url, email, token, ttlMs = 30_000)
  ├─ hit  → return cached ZdResult immediately
  ├─ in-flight → wait for the existing promise, then cache + return
  └─ miss → fetch → cache on success → return
```

After any mutation (POST / PUT / PATCH / DELETE), call `invalidateCacheFor(urlPrefix)` to bust stale entries for the affected resource.

### Layer 2 — Tool-level debounce (`debounceTool`)

Every read-only agent tool in `src/tools/index.ts` is wrapped with `debounceTool()`, which applies a **2-second per-parameter-set cache**. Identical back-to-back calls from the AI agent return the cached `AgentToolResult` without touching the network. Mutating tools (`createTicket`, `addComment`, etc.) are **not** debounced.

```
debounceTool(getTicket)  →  { ...getTicket, execute: cached wrapper }
```

### Layer 3 — Zendesk header rate-limit auto-wait

`src/api/base.ts` tracks the `X-RateLimit-Remaining` and `X-RateLimit-Reset` response headers per subdomain. When `remaining` reaches zero, `waitForRateLimit()` sleeps until the reset timestamp before the next request, preventing HTTP 429 errors entirely in normal operation.

### Layer 4 — Webhook token bucket

`src/webhook-handler.ts` enforces a **per-account configurable token-bucket** (default 60 requests per minute). Incoming webhook events that exceed this rate are dropped with HTTP 429 before they reach the queue processor.

Configure via `openclaw.plugin.json`:

```json
{
  "rateLimitPerMinute": 60,
  "queuePollIntervalMs": 30000
}
```

| Setting | Default | Effect |
|---|---|---|
| `rateLimitPerMinute` | `60` | Max inbound webhook events per minute per account |
| `queuePollIntervalMs` | `30000` | How often the autonomous queue processor polls Zendesk views |

---

## Reliability

### Circuit breaker

The autonomous queue processor wraps every poll cycle in a `CircuitBreaker` (`src/circuit-breaker.ts`). When Zendesk returns five consecutive errors the circuit opens and all polling is paused for **2 minutes** (by default), preventing runaway retries during an outage.

| State | Behaviour |
|---|---|
| `CLOSED` | Normal operation — every cycle runs |
| `OPEN` | Polling skipped; circuit reopens after `circuitRecoveryMs` |
| `HALF_OPEN` | One trial request; success → CLOSED, failure → OPEN again |

Configure via `QueueProcessorOptions`:

```ts
startQueueProcessor(channel, {
  circuitBreakerThreshold: 5,   // failures before opening (default 5)
  circuitRecoveryMs: 120_000,   // recovery window in ms (default 2 min)
});
```

### Incremental export mode

By default the queue processor calls the **Execute View** endpoint once per configured view per poll. For high-volume instances, enable incremental export mode instead:

```ts
startQueueProcessor(channel, {
  useIncrementalExport: true,
});
```

When enabled, a single call to `/api/v2/incremental/tickets.json?start_time=…` replaces all per-view calls each cycle. The processor stores a cursor (Unix timestamp) that advances after each poll, so only genuinely new/updated tickets are considered. Open and pending tickets are dispatched; solved and closed tickets are skipped.

| Mode | API calls per cycle |
|---|---|
| Default (view polling) | 1 per configured view |
| `useIncrementalExport: true` | Always 1 |

### SLA-aware dispatch priority

Before dispatching a batch of candidate tickets the queue processor sorts them so the most urgent work is handled first:

```
urgent → high → normal → low → (no priority)
```

Within the same priority band, tickets are ordered oldest-first so long-waiting customers are never starved.

---

## Troubleshooting

### Module not appearing in `openclaw channels status`

Check that the extension is registered:

```bash
openclaw config get extensions
```

The path to the Zendesk module should appear in the list.

### Probe fails with 401 Unauthorized

- Confirm `agentEmail` ends with `/token` when using token auth — the module handles this automatically, so check the raw token value has not been prefixed.
- Verify the API token is active: **Zendesk Admin → Apps & Integrations → APIs → Zendesk API → Active API Tokens**.

### Webhook payload not received

- Check the trigger is active and the webhook URL is correct.
- Confirm the OpenClaw gateway is publicly reachable on the configured port.
- Run `openclaw channels status --probe zendesk` to rule out credential issues.
- Check gateway logs: `openclaw gateway logs`.

### Bot replies to its own comments (infinite loop)

Add a trigger condition in Zendesk:

> **Performer** is not `bot@mycompany.com`

This prevents the trigger from firing when the bot adds a comment.

### Rate limit errors (429)

The `src/api/base.ts` layer automatically tracks `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers and sleeps before the next request when the limit is near. If you are still seeing 429s at high volume, increase `queuePollIntervalMs` or reduce the number of views being polled.

---

## License

MIT License — see [LICENSE](./LICENSE)

---

> **Built by [Progressive Robot Ltd](https://www.progressiverobot.com)**  
> © 2026 Progressive Robot Ltd. All rights reserved.  
>
> OpenClaw is a product of [OpenClaw AI](https://openclaw.ai).  
> Zendesk is a trademark of Zendesk, Inc.
