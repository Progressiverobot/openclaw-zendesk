/**
 * Zod config schema for the Zendesk channel plugin.
 *
 * Validated against channels.zendesk in openclaw.json.
 */

import { z } from "zod";

const ZendeskAccountSchemaBase = z
  .object({
    enabled: z.boolean().optional(),
    subdomain: z.string().optional(),
    agentEmail: z.string().email().optional(),
    apiToken: z.string().optional(),
    webhookSecret: z.string().optional(),
    webhookPath: z.string().optional(),
    publicReplies: z.boolean().optional(),
    dmPolicy: z.enum(["open", "allowlist", "disabled"]).optional().default("open"),
    allowedUserIds: z.union([z.string(), z.array(z.string())]).optional(),
    rateLimitPerMinute: z.number().int().positive().optional(),
  })
  .strict();

const ZendeskAccountSchema = ZendeskAccountSchemaBase;

export const ZendeskConfigSchema = ZendeskAccountSchemaBase.extend({
  accounts: z.record(z.string(), ZendeskAccountSchema).optional(),
}).strict();

export type ZendeskConfig = z.infer<typeof ZendeskConfigSchema>;
