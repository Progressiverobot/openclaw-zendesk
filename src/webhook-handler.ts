/**
 * Inbound webhook handler for Zendesk webhook events.
 *
 * Zendesk sends a signed HTTP POST to the configured webhookPath whenever
 * a trigger fires (e.g. "new ticket", "new comment from end-user").
 *
 * Security:
 *   - Signature verification via HMAC-SHA256 (X-Zendesk-Webhook-Signature)
 *   - Per-account rate limiting
 *   - dmPolicy enforcement (open | allowlist | disabled)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyWebhookSignature } from "./client.js";
import type { ZendeskWebhookPayload, ZendeskInboundMessage, ResolvedZendeskAccount } from "./types.js";

// ---------------------------------------------------------------------------
// Simple token-bucket rate limiter (same pattern as synology-chat)
// ---------------------------------------------------------------------------

class RateLimiter {
  private readonly windowMs = 60_000;
  private requests: number[] = [];

  constructor(private readonly maxPerMinute: number) {}

  tryConsume(): boolean {
    const now = Date.now();
    this.requests = this.requests.filter((ts) => now - ts < this.windowMs);
    if (this.requests.length >= this.maxPerMinute) return false;
    this.requests.push(now);
    return true;
  }

  clear(): void {
    this.requests = [];
  }

  maxRequests(): number {
    return this.maxPerMinute;
  }
}

const rateLimiters = new Map<string, RateLimiter>();

function getRateLimiter(account: ResolvedZendeskAccount): RateLimiter {
  let rl = rateLimiters.get(account.accountId);
  if (!rl || rl.maxRequests() !== account.rateLimitPerMinute) {
    rl?.clear();
    rl = new RateLimiter(account.rateLimitPerMinute);
    rateLimiters.set(account.accountId, rl);
  }
  return rl;
}

// ---------------------------------------------------------------------------
// Body reading helper (avoids a dependency on the SDK body reader import)
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 512_000; // 512 KB – generous for ticket webhooks

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.removeListener("data", onData);
        req.removeListener("end", onEnd);
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Payload parser
// ---------------------------------------------------------------------------

function parsePayload(rawBody: string): ZendeskWebhookPayload | null {
  try {
    return JSON.parse(rawBody) as ZendeskWebhookPayload;
  } catch {
    return null;
  }
}

function normalizePayload(
  payload: ZendeskWebhookPayload,
): ZendeskInboundMessage | null {
  const ticketId = String(payload.ticket_id ?? "").trim();
  if (!ticketId) return null;

  return {
    ticketId,
    subject: String(payload.ticket_subject ?? `Ticket #${ticketId}`).trim(),
    body: String(payload.message ?? "").trim(),
    requesterId: String(payload.requester_id ?? "").trim(),
    requesterName: String(payload.requester_name ?? "").trim(),
    requesterEmail: String(payload.requester_email ?? "").trim(),
    ticketStatus: String(payload.ticket_status ?? "").trim(),
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export interface WebhookHandlerOptions {
  account: ResolvedZendeskAccount;
  deliver: (msg: ZendeskInboundMessage) => Promise<unknown>;
  log?: { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };
}

/**
 * Returns a Node.js `(req, res) => void` handler ready to be registered with
 * `registerPluginHttpRoute`.
 */
export function createWebhookHandler(opts: WebhookHandlerOptions) {
  const { account, deliver, log } = opts;

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only accept POST
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      res.end("Method Not Allowed");
      return;
    }

    // Rate limit
    const limiter = getRateLimiter(account);
    if (!limiter.tryConsume()) {
      log?.warn?.(`[zendesk] Rate limit hit for account ${account.accountId}`);
      res.writeHead(429);
      res.end("Too Many Requests");
      return;
    }

    // Read body
    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch (err) {
      log?.warn?.(`[zendesk] Failed to read body: ${err}`);
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    // Verify signature (only if a secret is configured)
    if (account.webhookSecret) {
      const signature = String(req.headers["x-zendesk-webhook-signature"] ?? "");
      const timestamp = String(req.headers["x-zendesk-webhook-signature-timestamp"] ?? "");

      const valid = await verifyWebhookSignature(
        account.webhookSecret,
        timestamp,
        rawBody,
        signature,
      ).catch(() => false);

      if (!valid) {
        log?.warn?.(`[zendesk] Invalid webhook signature for account ${account.accountId}`);
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
    }

    // Parse JSON payload
    const payload = parsePayload(rawBody);
    if (!payload) {
      log?.warn?.(`[zendesk] Could not parse webhook payload`);
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    const msg = normalizePayload(payload);
    if (!msg) {
      log?.warn?.(`[zendesk] Payload missing ticket_id – ignoring`);
      // Return 200 to prevent Zendesk from retrying
      res.writeHead(200);
      res.end("OK");
      return;
    }

    // Enforce dmPolicy
    if (account.dmPolicy === "disabled") {
      log?.info?.(
        `[zendesk] dmPolicy=disabled, ignoring ticket ${msg.ticketId}`,
      );
      res.writeHead(200);
      res.end("OK");
      return;
    }

    if (account.dmPolicy === "allowlist") {
      const allowed =
        account.allowedUserIds.includes(msg.requesterId) ||
        account.allowedUserIds.includes(msg.requesterEmail.toLowerCase());
      if (!allowed) {
        log?.info?.(
          `[zendesk] Requester ${msg.requesterId} (${msg.requesterEmail}) not in allowedUserIds – ignoring`,
        );
        res.writeHead(200);
        res.end("OK");
        return;
      }
    }

    // Acknowledge immediately so Zendesk doesn't retry
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));

    // Deliver asynchronously so the HTTP response isn't blocked on agent processing
    deliver(msg).catch((err) => {
      log?.error?.(`[zendesk] Error delivering message for ticket ${msg.ticketId}: ${err}`);
    });
  };
}
