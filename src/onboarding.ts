/**
 * Guided onboarding flow for the Zendesk channel plugin.
 *
 * Walks the user through locating their:
 *   1. Zendesk subdomain
 *   2. Agent email address
 *   3. API token (generated in Zendesk Admin → Apps & Integrations → APIs → API Token)
 *   4. Webhook signing secret (generated in Zendesk Admin → Apps & Integrations → Webhooks)
 *
 * Then validates all credentials via the probe and generates a starter
 * openclaw.json snippet and Zendesk trigger YAML for copy-paste.
 */

import type { ResolvedZendeskAccount } from "./types.js";
import { probeZendesk } from "./probe.js";

// ---------------------------------------------------------------------------
// Setup instructions (rendered as agent prompt hints / onboarding message)
// ---------------------------------------------------------------------------

export const ZENDESK_SETUP_STEPS = [
  "### Zendesk Channel Setup",
  "",
  "**Step 1 – Get your Zendesk subdomain**",
  "Your Zendesk subdomain is the prefix of your Zendesk URL.",
  "Example: if your URL is `https://mycompany.zendesk.com`, the subdomain is `mycompany`.",
  "",
  "**Step 2 – Create an API token**",
  '1. In Zendesk Admin Center, go to **Apps & Integrations → APIs → Zendesk API**.',
  "2. Enable **\"Token access\"**.",
  "3. Click **Add API token**, give it a name, and copy the token.",
  "   ⚠️ The token is only shown once – save it securely.",
  "",
  "**Step 3 – Create a Webhook**",
  "1. Go to **Apps & Integrations → Webhooks → Create webhook**.",
  "2. Set the Endpoint URL to: `https://YOUR_GATEWAY_HOST/webhook/zendesk`",
  "3. Set Authentication to **None** (OpenClaw uses the signing secret instead).",
  "4. Enable **Webhook signing** and copy the **Signing secret**.",
  "",
  "**Step 4 – Create a Trigger**",
  "1. Go to **Business rules → Triggers → Add trigger**.",
  "2. Set conditions: e.g. `Ticket is Created` OR `Comment is Added by End-user`.",
  "3. Add action: **Notify active webhook** → select the webhook you created.",
  "4. Set the JSON body template (copy the template below).",
  "",
  "**Step 5 – Add to openclaw.json**",
  "```json",
  '"channels": {',
  '  "zendesk": {',
  '    "subdomain": "YOUR_SUBDOMAIN",',
  '    "agentEmail": "bot@yourcompany.com",',
  '    "apiToken": "YOUR_API_TOKEN",',
  '    "webhookSecret": "YOUR_SIGNING_SECRET",',
  '    "publicReplies": true,',
  '    "dmPolicy": "open"',
  "  }",
  "}",
  "```",
  "",
  "**Webhook JSON body template** (paste into Zendesk trigger's body field):",
  "```json",
  "{",
  '  "ticket_id": "{{ticket.id}}",',
  '  "ticket_subject": "{{ticket.title}}",',
  '  "ticket_status": "{{ticket.status}}",',
  '  "message": "{{ticket.latest_comment_html}}",',
  '  "requester_id": "{{ticket.requester.id}}",',
  '  "requester_name": "{{ticket.requester.name}}",',
  '  "requester_email": "{{ticket.requester.email}}"',
  "}",
  "```",
] as const;

// ---------------------------------------------------------------------------
// Onboarding status helper
// ---------------------------------------------------------------------------

export interface OnboardingStatus {
  configured: boolean;
  issues: string[];
  suggestions: string[];
}

/**
 * Assess whether a resolved account is ready to use
 * without making any API calls (pure config inspection).
 */
export function checkOnboardingStatus(
  account: ResolvedZendeskAccount,
): OnboardingStatus {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!account.subdomain) {
    issues.push("subdomain is not set");
    suggestions.push('Set channels.zendesk.subdomain = "yourcompany"');
  }
  if (!account.agentEmail) {
    issues.push("agentEmail is not set");
    suggestions.push("Set channels.zendesk.agentEmail to the Zendesk agent email");
  }
  if (!account.apiToken) {
    issues.push("apiToken is not set");
    suggestions.push("Create an API token in Zendesk Admin → APIs → Zendesk API");
  }
  if (!account.webhookSecret) {
    suggestions.push(
      "Strongly recommended: set channels.zendesk.webhookSecret for HMAC signature verification",
    );
  }
  if (account.dmPolicy === "allowlist" && account.allowedUserIds.length === 0) {
    issues.push(
      'dmPolicy="allowlist" with no allowedUserIds – add user IDs/emails or change dmPolicy to "open"',
    );
  }

  return {
    configured: issues.length === 0,
    issues,
    suggestions,
  };
}

/**
 * Run the full onboarding check: config inspection + live probe.
 * Returns a human-readable status report.
 */
export async function runOnboarding(account: ResolvedZendeskAccount): Promise<string> {
  const lines: string[] = [];

  const status = checkOnboardingStatus(account);
  if (!status.configured) {
    lines.push("❌ Zendesk channel is not fully configured:");
    for (const issue of status.issues) {
      lines.push(`  • ${issue}`);
    }
    lines.push("");
    lines.push("To fix:");
    for (const s of status.suggestions) {
      lines.push(`  → ${s}`);
    }
    lines.push("");
    lines.push(ZENDESK_SETUP_STEPS.join("\n"));
    return lines.join("\n");
  }

  if (status.suggestions.length > 0) {
    lines.push("⚠️  Suggestions:");
    for (const s of status.suggestions) {
      lines.push(`  → ${s}`);
    }
    lines.push("");
  }

  // Live probe
  lines.push("🔍 Testing connectivity to Zendesk...");
  const probe = await probeZendesk(account);
  if (probe.ok) {
    lines.push(`✅ ${probe.status}`);
    if (probe.detail) {
      for (const line of probe.detail.split("\n")) {
        lines.push(`   ${line}`);
      }
    }
  } else {
    lines.push(`❌ ${probe.status}: ${probe.error ?? "unknown error"}`);
    lines.push("");
    lines.push(ZENDESK_SETUP_STEPS.join("\n"));
  }

  return lines.join("\n");
}
