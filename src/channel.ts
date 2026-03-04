/**
 * Zendesk ChannelPlugin implementation for OpenClaw.
 *
 * Inbound:  Zendesk webhook → OpenClaw agent
 * Outbound: OpenClaw agent → Zendesk ticket comment (via REST API)
 *
 * Each Zendesk ticket is treated as a conversation (session).
 * The session key is zendesk:{ticketId}.
 */

import {
  DEFAULT_ACCOUNT_ID,
  setAccountEnabledInConfigSection,
  registerPluginHttpRoute,
  buildChannelConfigSchema,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { listAccountIds, resolveAccount } from "./accounts.js";
import { addTicketComment, updateTicket } from "./client.js";
import { probeZendesk } from "./probe.js";
import { buildTicketContext } from "./ticket-context.js";
import { checkOnboardingStatus } from "./onboarding.js";
import { getZendeskRuntime } from "./runtime.js";
import type { ResolvedZendeskAccount, ZendeskInboundMessage } from "./types.js";
import { createWebhookHandler } from "./webhook-handler.js";
import { createZendeskAgentTools } from "./tools/index.js";
import { startQueueProcessor } from "./queue-processor.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHANNEL_ID = "zendesk";

const ZendeskConfigSchema = buildChannelConfigSchema(z.object({}).passthrough());

// Tracks registered HTTP route unregistration callbacks, keyed per account
const activeRouteUnregisters = new Map<string, () => void>();

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function waitUntilAbort(signal?: AbortSignal, onAbort?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const complete = () => {
      onAbort?.();
      resolve();
    };
    if (!signal) return;
    if (signal.aborted) {
      complete();
      return;
    }
    signal.addEventListener("abort", complete, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createZendeskPlugin() {
  return {
    id: CHANNEL_ID,

    meta: {
      id: CHANNEL_ID,
      label: "Zendesk",
      selectionLabel: "Zendesk (Support)",
      detailLabel: "Zendesk Support",
      docsPath: "/channels/zendesk",
      blurb: "Receive Zendesk support tickets and reply with your AI agent",
      order: 95,
    },

    capabilities: {
      chatTypes: ["direct" as const],
      media: false,
      threads: false,
      reactions: false,
      edit: false,
      unsend: false,
      reply: false,
      effects: false,
      blockStreaming: false,
    },

    reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },

    configSchema: ZendeskConfigSchema,

    // -----------------------------------------------------------------------
    // Account management
    // -----------------------------------------------------------------------
    config: {
      listAccountIds: (cfg: unknown) => listAccountIds(cfg),

      resolveAccount: (cfg: unknown, accountId?: string | null) =>
        resolveAccount(cfg, accountId),

      defaultAccountId: (_cfg: unknown) => DEFAULT_ACCOUNT_ID,

      setAccountEnabled: ({ cfg, accountId, enabled }: { cfg: unknown; accountId: string; enabled: boolean }) => {
        const channelConfig = (cfg as any)?.channels?.[CHANNEL_ID] ?? {};
        if (accountId === DEFAULT_ACCOUNT_ID) {
          return {
            ...(cfg as object),
            channels: {
              ...(cfg as any).channels,
              [CHANNEL_ID]: { ...channelConfig, enabled },
            },
          };
        }
        return setAccountEnabledInConfigSection({
          cfg,
          sectionKey: `channels.${CHANNEL_ID}`,
          accountId,
          enabled,
        });
      },
    },

    // -----------------------------------------------------------------------
    // Pairing / identity
    // -----------------------------------------------------------------------
    pairing: {
      idLabel: "zendeskUserId",
      normalizeAllowEntry: (entry: string) => entry.toLowerCase().trim(),
      notifyApproval: async ({ cfg, id }: { cfg: unknown; id: string }) => {
        // For Zendesk, "approval" means adding a comment to the ticket
        const account = resolveAccount(cfg);
        if (!account.subdomain || !account.apiToken) return;
        await addTicketComment(
          account.subdomain,
          account.agentEmail,
          account.apiToken,
          id, // id here is the ticket ID
          "OpenClaw: your access has been approved.",
          false, // internal note
        );
      },
    },

    // -----------------------------------------------------------------------
    // Security (dmPolicy)
    // -----------------------------------------------------------------------
    security: {
      resolveDmPolicy: ({
        cfg,
        accountId,
        account,
      }: {
        cfg: unknown;
        accountId?: string | null;
        account: ResolvedZendeskAccount;
      }) => {
        const resolvedAccountId =
          accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
        const channelCfg = (cfg as any)?.channels?.["zendesk"];
        const useAccountPath = Boolean(
          channelCfg?.accounts?.[resolvedAccountId],
        );
        const basePath = useAccountPath
          ? `channels.zendesk.accounts.${resolvedAccountId}.`
          : "channels.zendesk.";
        return {
          policy: account.dmPolicy ?? "open",
          allowFrom: account.allowedUserIds ?? [],
          policyPath: `${basePath}dmPolicy`,
          allowFromPath: basePath,
          approveHint: "openclaw pairing approve zendesk <ticketId>",
          normalizeEntry: (raw: string) => raw.toLowerCase().trim(),
        };
      },

      collectWarnings: ({ account }: { account: ResolvedZendeskAccount }) => {
        const warnings: string[] = [];
        if (!account.subdomain) {
          warnings.push(
            "- Zendesk: subdomain is not configured (e.g. channels.zendesk.subdomain = \"mycompany\").",
          );
        }
        if (!account.agentEmail) {
          warnings.push(
            "- Zendesk: agentEmail is not configured. Set channels.zendesk.agentEmail.",
          );
        }
        if (!account.apiToken) {
          warnings.push(
            "- Zendesk: apiToken is not configured. Set channels.zendesk.apiToken.",
          );
        }
        if (!account.webhookSecret) {
          warnings.push(
            "- Zendesk: webhookSecret is not set. Incoming webhooks will not be signature-verified.",
          );
        }
        if (account.dmPolicy === "allowlist" && account.allowedUserIds.length === 0) {
          warnings.push(
            '- Zendesk: dmPolicy="allowlist" with no allowedUserIds blocks every inbound ticket. Add user IDs/emails or set dmPolicy="open".',
          );
        }
        return warnings;
      },
    },

    // -----------------------------------------------------------------------
    // Messaging helpers
    // -----------------------------------------------------------------------
    messaging: {
      normalizeTarget: (target: string) => {
        const trimmed = target.trim();
        if (!trimmed) return undefined;
        return trimmed.replace(/^zendesk:/i, "").trim();
      },
      targetResolver: {
        looksLikeId: (id: string) => {
          const trimmed = id?.trim();
          if (!trimmed) return false;
          return /^\d+$/.test(trimmed) || /^zendesk:/i.test(trimmed);
        },
        hint: "<ticketId>",
      },
    },

    // -----------------------------------------------------------------------
    // Probe – health check for `openclaw channels status --probe`
    // -----------------------------------------------------------------------
    probe: {
      run: async ({ cfg, accountId }: { cfg: unknown; accountId?: string | null }) => {
        const account = resolveAccount(cfg, accountId);
        const result = await probeZendesk(account);
        return {
          ok: result.ok,
          status: result.status,
          detail: result.detail,
          error: result.error,
        };
      },
    },

    // -----------------------------------------------------------------------
    // Directory (no user-listing supported)
    // -----------------------------------------------------------------------
    directory: {
      self: async () => null,
      listPeers: async () => [],
      listGroups: async () => [],
    },

    // -----------------------------------------------------------------------
    // Outbound – agent → Zendesk ticket comment
    // -----------------------------------------------------------------------
    outbound: {
      deliveryMode: "gateway" as const,
      textChunkLimit: 3000,

      sendText: async ({ to, text, accountId, cfg }: { to: string; text: string; accountId?: string | null; cfg: unknown }) => {
        const account: ResolvedZendeskAccount = resolveAccount(cfg ?? {}, accountId);

        if (!account.subdomain || !account.apiToken) {
          throw new Error("Zendesk: subdomain / apiToken not configured");
        }

        const ticketId = to.replace(/^zendesk:/i, "").trim();
        const result = await addTicketComment(
          account.subdomain,
          account.agentEmail,
          account.apiToken,
          ticketId,
          text,
          account.publicReplies,
        );

        if (!result.ok) {
          throw new Error(`Zendesk: failed to add comment – ${result.error}`);
        }

        return {
          channel: CHANNEL_ID,
          messageId: `zd-${ticketId}-${Date.now()}`,
          chatId: ticketId,
        };
      },

      // Zendesk doesn't support binary media uploads via the webhook flow;
      // include a link in the text comment instead.
      sendMedia: async ({ to, mediaUrl, accountId, cfg }: { to: string; mediaUrl: string; accountId?: string | null; cfg: unknown }) => {
        const account: ResolvedZendeskAccount = resolveAccount(cfg ?? {}, accountId);

        if (!account.subdomain || !account.apiToken) {
          throw new Error("Zendesk: subdomain / apiToken not configured");
        }

        const ticketId = to.replace(/^zendesk:/i, "").trim();
        const text = `Attachment: ${mediaUrl}`;
        const result = await addTicketComment(
          account.subdomain,
          account.agentEmail,
          account.apiToken,
          ticketId,
          text,
          account.publicReplies,
        );

        if (!result.ok) {
          throw new Error(`Zendesk: failed to add media comment – ${result.error}`);
        }

        return {
          channel: CHANNEL_ID,
          messageId: `zd-${ticketId}-media-${Date.now()}`,
          chatId: ticketId,
        };
      },

      /**
       * Update ticket metadata (status, priority, tags).
       * Called directly by agent tools when it decides to solve/escalate.
       */
      updateTicketMeta: async ({
        to,
        accountId,
        cfg,
        status,
        priority,
        tags,
      }: {
        to: string;
        accountId?: string | null;
        cfg: unknown;
        status?: "open" | "pending" | "solved" | "closed";
        priority?: "low" | "normal" | "high" | "urgent";
        tags?: string[];
      }) => {
        const account: ResolvedZendeskAccount = resolveAccount(cfg ?? {}, accountId);
        if (!account.subdomain || !account.apiToken) {
          throw new Error("Zendesk: subdomain / apiToken not configured");
        }
        const ticketId = to.replace(/^zendesk:/i, "").trim();
        const result = await updateTicket(
          account.subdomain,
          account.agentEmail,
          account.apiToken,
          ticketId,
          { status, priority, tags },
        );
        if (!result.ok) {
          throw new Error(`Zendesk: failed to update ticket – ${result.error}`);
        }
        return { channel: CHANNEL_ID, chatId: ticketId };
      },
    },

    // -----------------------------------------------------------------------
    // Gateway – long-running webhook listener per account
    // -----------------------------------------------------------------------
    gateway: {
      startAccount: async (ctx: {
        cfg: unknown;
        accountId: string;
        log?: { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void };
        abortSignal?: AbortSignal;
      }) => {
        const { cfg, accountId, log } = ctx;
        const account = resolveAccount(cfg, accountId);

        if (!account.enabled) {
          log?.info?.(`[zendesk] Account ${accountId} is disabled, skipping`);
          return waitUntilAbort(ctx.abortSignal);
        }

        // Check onboarding status before trying to start
        const onboardingStatus = checkOnboardingStatus(account);
        if (!onboardingStatus.configured) {
          log?.warn?.(
            `[zendesk] Account ${accountId} not fully configured: ${onboardingStatus.issues.join("; ")}`,
          );
          return waitUntilAbort(ctx.abortSignal);
        }

        // Run probe to verify credentials before registering the route
        log?.info?.(`[zendesk] Probing Zendesk API for account ${accountId}...`);
        const probe = await probeZendesk(account);
        if (!probe.ok) {
          log?.warn?.(
            `[zendesk] Probe failed for account ${accountId}: ${probe.error}. Webhook will still be registered but delivery may fail.`,
          );
        } else {
          log?.info?.(`[zendesk] Probe ok – ${probe.detail?.split("\n")[0] ?? probe.status}`);
        }

        log?.info?.(
          `[zendesk] Starting webhook listener for account ${accountId} on ${account.webhookPath}`,
        );

        const handler = createWebhookHandler({
          account,
          deliver: async (msg: ZendeskInboundMessage) => {
            const rt = getZendeskRuntime();
            const currentCfg = await rt.config.loadConfig();

            // Enrich context: fetch ticket history before dispatching to agent
            let contextBlock = "";
            try {
              const ticketCtx = await buildTicketContext(
                account.subdomain,
                account.agentEmail,
                account.apiToken,
                msg.ticketId,
                20,
              );
              contextBlock = ticketCtx.formatted;
            } catch (err) {
              log?.warn?.(`[zendesk] Could not build ticket context for ${msg.ticketId}: ${err}`);
            }

            const from = `zendesk:${msg.ticketId}`;
            const senderLabel =
              msg.requesterName ||
              msg.requesterEmail ||
              `User ${msg.requesterId}`;

            // Prepend ticket context to the message body so the agent sees
            // the full thread, but the Body used for command matching is just
            // the latest message.
            const enrichedBody = contextBlock
              ? `${contextBlock}\n\n---\n**Latest message from ${senderLabel}:**\n${msg.body || `[Ticket #${msg.ticketId}] ${msg.subject}`}`
              : msg.body || `[Ticket #${msg.ticketId}] ${msg.subject}`;

            const msgCtx = rt.channel.reply.finalizeInboundContext({
              Body: enrichedBody,
              RawBody: msg.body,
              CommandBody: msg.body,
              From: from,
              To: from,
              SessionKey: `zendesk:${msg.ticketId}`,
              AccountId: account.accountId,
              OriginatingChannel: CHANNEL_ID,
              OriginatingTo: from,
              ChatType: "direct",
              SenderName: senderLabel,
              SenderId: msg.requesterId || msg.requesterEmail,
              Provider: CHANNEL_ID,
              Surface: CHANNEL_ID,
              ConversationLabel: `Ticket #${msg.ticketId}: ${msg.subject}`,
              Timestamp: Date.now(),
              CommandAuthorized: true,
            });

            await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: msgCtx,
              cfg: currentCfg,
              dispatcherOptions: {
                deliver: async (payload: { text?: string; body?: string }) => {
                  const text = payload?.text ?? payload?.body;
                  if (text) {
                    await addTicketComment(
                      account.subdomain,
                      account.agentEmail,
                      account.apiToken,
                      msg.ticketId,
                      text,
                      account.publicReplies,
                    );
                  }
                },
                onReplyStart: () => {
                  log?.info?.(
                    `[zendesk] Agent reply started for ticket ${msg.ticketId}`,
                  );
                },
              },
            });
          },
          log,
        });

        // Deregister stale routes from previous starts to avoid collisions
        const routeKey = `${accountId}:${account.webhookPath}`;
        const prevUnregister = activeRouteUnregisters.get(routeKey);
        if (prevUnregister) {
          log?.info?.(
            `[zendesk] Deregistering stale route before re-registering: ${account.webhookPath}`,
          );
          prevUnregister();
          activeRouteUnregisters.delete(routeKey);
        }

        const unregister = registerPluginHttpRoute({
          path: account.webhookPath,
          auth: "plugin",
          replaceExisting: true,
          pluginId: CHANNEL_ID,
          accountId: account.accountId,
          log: (msg: string) => log?.info?.(msg),
          handler,
        });

        activeRouteUnregisters.set(routeKey, unregister);
        log?.info?.(
          `[zendesk] Registered HTTP route: ${account.webhookPath}`,
        );

        // Start autonomous queue processor if view IDs or incremental export is configured
        const viewIds: string[] = (account as any).queueViewIds ?? [];
        const queuePollMs: number = (account as any).queuePollIntervalMs ?? 30_000;
        const useIncrementalExport: boolean = (account as any).useIncrementalExport ?? false;
        const circuitBreakerThreshold: number = (account as any).circuitBreakerThreshold ?? 5;
        const circuitRecoveryMs: number = (account as any).circuitRecoveryMs ?? 120_000;
        const queueActive = viewIds.length > 0 || useIncrementalExport;
        const queueProc = queueActive
          ? startQueueProcessor({
              creds: account,
              viewIds,
              pollIntervalMs: queuePollMs,
              useIncrementalExport,
              circuitBreakerThreshold,
              circuitRecoveryMs,
              dispatch: async (ticket) => {
                const rt = getZendeskRuntime();
                const currentCfg = await rt.config.loadConfig();

                let contextBlock = "";
                try {
                  const ticketCtx = await buildTicketContext(
                    account.subdomain,
                    account.agentEmail,
                    account.apiToken,
                    String(ticket.id),
                    20,
                  );
                  contextBlock = ticketCtx.formatted;
                } catch (ctxErr) {
                  log?.warn?.(`[zendesk] Could not build ticket context for queue ticket ${ticket.id}: ${ctxErr}`);
                }

                const from = `zendesk:${ticket.id}`;
                const enrichedBody = contextBlock
                  ? `${contextBlock}\n\n---\n**[Queue ticket #${ticket.id}]** ${ticket.subject}`
                  : `[Queue ticket #${ticket.id}] ${ticket.subject}`;

                const msgCtx = rt.channel.reply.finalizeInboundContext({
                  Body: enrichedBody,
                  RawBody: ticket.subject,
                  CommandBody: ticket.subject,
                  From: from,
                  To: from,
                  SessionKey: `zendesk:${ticket.id}`,
                  AccountId: account.accountId,
                  OriginatingChannel: CHANNEL_ID,
                  OriginatingTo: from,
                  ChatType: "direct",
                  SenderName: `Queue Ticket #${ticket.id}`,
                  SenderId: String(ticket.requester_id ?? "queue"),
                  Provider: CHANNEL_ID,
                  Surface: CHANNEL_ID,
                  ConversationLabel: `Queue Ticket #${ticket.id}: ${ticket.subject}`,
                  Timestamp: Date.now(),
                  CommandAuthorized: true,
                });

                await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                  ctx: msgCtx,
                  cfg: currentCfg,
                  dispatcherOptions: {
                    deliver: async (payload: { text?: string; body?: string }) => {
                      const text = payload?.text ?? payload?.body;
                      if (text) {
                        await addTicketComment(
                          account.subdomain,
                          account.agentEmail,
                          account.apiToken,
                          String(ticket.id),
                          text,
                          account.publicReplies,
                        );
                      }
                    },
                    onReplyStart: () => {
                      log?.info?.(`[zendesk] Queue reply started for ticket ${ticket.id}`);
                    },
                  },
                });
              },
              abortSignal: ctx.abortSignal,
              log: {
                info: (m: string) => log?.info?.(m),
                warn: (m: string) => log?.warn?.(m),
                error: (m: string, ...a: unknown[]) => log?.error?.(`${m} ${a.join(" ")}`.trim()),
              },
            })
          : null;

        if (queueProc) {
          const modeLabel = useIncrementalExport ? "incremental export" : `${viewIds.length} view(s)`;
          log?.info?.(`[zendesk] Queue processor started (${modeLabel})`);
        }

        return waitUntilAbort(ctx.abortSignal, () => {
          log?.info?.(`[zendesk] Stopping account ${accountId}`);
          if (typeof unregister === "function") unregister();
          activeRouteUnregisters.delete(routeKey);
          queueProc?.stop();
        });
      },

      stopAccount: async (ctx: { accountId: string; log?: { info?: (m: string) => void } }) => {
        ctx.log?.info?.(`[zendesk] Account ${ctx.accountId} stopped`);
      },
    },

    // -----------------------------------------------------------------------
    // Agent tools – 40+ tools for fully autonomous Zendesk operation
    // -----------------------------------------------------------------------
    agentTools: createZendeskAgentTools,

    // -----------------------------------------------------------------------
    // Agent prompt hints
    // -----------------------------------------------------------------------
    agentPrompt: {
      messageToolHints: () => [
        "",
        "### Zendesk Channel – Agent Guide",
        "",
        "**Context**: Each inbound message includes the full ticket history. Review it before replying.",
        "",
        "**Text formatting**: Zendesk supports Markdown in ticket comments.",
        "  - Bold: **text**, Italic: *text*, Code: `code`, Code block: ```",
        "  - Links: [label](https://example.com)",
        "  - Lists: `- item` (bullets) or `1. item` (numbered)",
        "",
        "**Ticket lifecycle actions** (use the `updateTicket` tool or embed action markers):",
        "  - Solve a ticket: set status to `solved` once the issue is resolved.",
        "  - Mark as pending: set status to `pending` when waiting on the customer.",
        "  - Set priority: `low` | `normal` | `high` | `urgent`.",
        "  - Add tags: use descriptive tags to categorise issues for reporting.",
        "",
        "**Reply visibility**:",
        "  - Public replies (publicReplies=true): visible to the end-user.",
        "  - Internal notes (publicReplies=false): visible to agents only. Use for analysis,",
        "    escalation context, or sensitive information.",
        "",
        "**Best practices**:",
        "  - Be concise, professional, and empathetic – this is customer support.",
        "  - Always acknowledge the issue before offering a solution.",
        "  - Reference ticket IDs when escalating or cross-referencing: Ticket #<id>.",
        "  - Avoid solving a ticket unless the issue is definitively addressed.",
        "  - Urgent/high priority tickets should be actioned before normal/low.",
      ],
    },
  };
}
