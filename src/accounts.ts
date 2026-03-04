/**
 * Account resolution for the Zendesk channel plugin.
 * Reads config from channels.zendesk, merges per-account overrides,
 * falls back to environment variables.
 */

import type {
  ZendeskChannelConfig,
  ZendeskAccountRaw,
  ResolvedZendeskAccount,
} from "./types.js";

const CHANNEL_KEY = "zendesk";

function getChannelConfig(cfg: unknown): ZendeskChannelConfig | undefined {
  return (cfg as any)?.channels?.[CHANNEL_KEY];
}

function parseAllowedUserIds(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * List all configured account IDs for this channel.
 * Returns ["default"] if a base config with an API token exists,
 * plus any explicitly named accounts.
 */
export function listAccountIds(cfg: unknown): string[] {
  const channelCfg = getChannelConfig(cfg);
  if (!channelCfg) return [];

  const ids = new Set<string>();

  const hasBaseToken =
    channelCfg.apiToken || process.env.ZENDESK_API_TOKEN;
  if (hasBaseToken) {
    ids.add("default");
  }

  if (channelCfg.accounts) {
    for (const id of Object.keys(channelCfg.accounts)) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

/**
 * Fully resolve a named (or default) account, merging overrides on top of
 * base config and environment-variable fallbacks.
 */
export function resolveAccount(
  cfg: unknown,
  accountId?: string | null,
): ResolvedZendeskAccount {
  const channelCfg: ZendeskChannelConfig = getChannelConfig(cfg) ?? {};
  const id = accountId || "default";

  const accountOverride: ZendeskAccountRaw =
    channelCfg.accounts?.[id] ?? {};

  // Env var fallbacks (primarily for the "default" account)
  const envSubdomain = process.env.ZENDESK_SUBDOMAIN ?? "";
  const envEmail = process.env.ZENDESK_AGENT_EMAIL ?? "";
  const envToken = process.env.ZENDESK_API_TOKEN ?? "";
  const envSecret = process.env.ZENDESK_WEBHOOK_SECRET ?? "";
  const envAllowedUsers = process.env.ZENDESK_ALLOWED_USER_IDS ?? "";
  const envRateLimit = process.env.ZENDESK_RATE_LIMIT;

  // Merge: account-override > base channel config > env var
  return {
    accountId: id,
    enabled: accountOverride.enabled ?? channelCfg.enabled ?? true,
    subdomain:
      accountOverride.subdomain ?? channelCfg.subdomain ?? envSubdomain,
    agentEmail:
      accountOverride.agentEmail ?? channelCfg.agentEmail ?? envEmail,
    apiToken:
      accountOverride.apiToken ?? channelCfg.apiToken ?? envToken,
    webhookSecret:
      accountOverride.webhookSecret ??
      channelCfg.webhookSecret ??
      envSecret,
    webhookPath:
      accountOverride.webhookPath ??
      channelCfg.webhookPath ??
      "/webhook/zendesk",
    publicReplies:
      accountOverride.publicReplies ?? channelCfg.publicReplies ?? true,
    dmPolicy:
      accountOverride.dmPolicy ?? channelCfg.dmPolicy ?? "open",
    allowedUserIds: parseAllowedUserIds(
      accountOverride.allowedUserIds ??
        channelCfg.allowedUserIds ??
        envAllowedUsers,
    ),
    rateLimitPerMinute:
      accountOverride.rateLimitPerMinute ??
      channelCfg.rateLimitPerMinute ??
      (envRateLimit ? parseInt(envRateLimit, 10) : 60),
  };
}
