/**
 * Unit tests for the inbound webhook handler.
 *
 * Run with: pnpm test (vitest)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { createWebhookHandler } from "./webhook-handler.js";
import type { ResolvedZendeskAccount, ZendeskInboundMessage } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccount(overrides: Partial<ResolvedZendeskAccount> = {}): ResolvedZendeskAccount {
  return {
    accountId: "default",
    enabled: true,
    subdomain: "testco",
    agentEmail: "bot@testco.com",
    apiToken: "test-token",
    webhookSecret: "", // disabled by default in these tests to keep them simple
    webhookPath: "/webhook/zendesk",
    publicReplies: true,
    dmPolicy: "open",
    allowedUserIds: [],
    rateLimitPerMinute: 100,
    ...overrides,
  };
}

function makeRequest(
  body: string,
  headers: Record<string, string> = {},
  method = "POST",
): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  (emitter as any).method = method;
  (emitter as any).headers = {
    "content-type": "application/json",
    ...headers,
  };

  // Simulate readable body
  process.nextTick(() => {
    emitter.emit("data", Buffer.from(body));
    emitter.emit("end");
  });

  return emitter;
}

function makeResponse(): ServerResponse & { _status?: number; _body?: string } {
  const emitter = new EventEmitter() as any;
  emitter._status = undefined;
  emitter._body = undefined;
  emitter.writeHead = (status: number) => { emitter._status = status; };
  emitter.end = (body?: string) => { emitter._body = body; };
  return emitter;
}

const VALID_PAYLOAD = JSON.stringify({
  ticket_id: "42",
  ticket_subject: "Help with login",
  message: "I cannot log in to my account.",
  requester_id: "101",
  requester_name: "Alice Smith",
  requester_email: "alice@example.com",
  ticket_status: "new",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createWebhookHandler", () => {
  let deliver: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    deliver = vi.fn().mockResolvedValue(undefined);
  });

  it("accepts a valid POST and calls deliver", async () => {
    const handler = createWebhookHandler({
      account: makeAccount(),
      deliver,
    });

    const req = makeRequest(VALID_PAYLOAD);
    const res = makeResponse();

    await handler(req, res);

    expect(res._status).toBe(200);
    // Give deliver a tick to run (it's fire-and-forget)
    await new Promise((r) => setTimeout(r, 10));
    expect(deliver).toHaveBeenCalledOnce();
    const msg: ZendeskInboundMessage = deliver.mock.calls[0][0];
    expect(msg.ticketId).toBe("42");
    expect(msg.body).toBe("I cannot log in to my account.");
    expect(msg.requesterEmail).toBe("alice@example.com");
  });

  it("rejects non-POST requests with 405", async () => {
    const handler = createWebhookHandler({ account: makeAccount(), deliver });
    const req = makeRequest(VALID_PAYLOAD, {}, "GET");
    const res = makeResponse();
    await handler(req, res);
    expect(res._status).toBe(405);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("returns 200 and skips deliver when dmPolicy=disabled", async () => {
    const handler = createWebhookHandler({
      account: makeAccount({ dmPolicy: "disabled" }),
      deliver,
    });
    const req = makeRequest(VALID_PAYLOAD);
    const res = makeResponse();
    await handler(req, res);
    expect(res._status).toBe(200);
    // Wait a tick to confirm deliver is never called
    await new Promise((r) => setTimeout(r, 10));
    expect(deliver).not.toHaveBeenCalled();
  });

  it("blocks non-allowlisted user when dmPolicy=allowlist", async () => {
    const handler = createWebhookHandler({
      account: makeAccount({
        dmPolicy: "allowlist",
        allowedUserIds: ["999"],
      }),
      deliver,
    });
    const req = makeRequest(VALID_PAYLOAD); // requester_id="101"
    const res = makeResponse();
    await handler(req, res);
    expect(res._status).toBe(200); // 200 to prevent Zendesk retries
    await new Promise((r) => setTimeout(r, 10));
    expect(deliver).not.toHaveBeenCalled();
  });

  it("permits allowlisted user by ID", async () => {
    const handler = createWebhookHandler({
      account: makeAccount({
        dmPolicy: "allowlist",
        allowedUserIds: ["101"],
      }),
      deliver,
    });
    const req = makeRequest(VALID_PAYLOAD);
    const res = makeResponse();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 10));
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("permits allowlisted user by email", async () => {
    const handler = createWebhookHandler({
      account: makeAccount({
        dmPolicy: "allowlist",
        allowedUserIds: ["alice@example.com"],
      }),
      deliver,
    });
    const req = makeRequest(VALID_PAYLOAD);
    const res = makeResponse();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 10));
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("returns 400 for malformed JSON", async () => {
    const handler = createWebhookHandler({ account: makeAccount(), deliver });
    const req = makeRequest("not-json");
    const res = makeResponse();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("returns 200 and skips deliver for payload without ticket_id", async () => {
    const handler = createWebhookHandler({ account: makeAccount(), deliver });
    const req = makeRequest(JSON.stringify({ message: "oops, no ticket id" }));
    const res = makeResponse();
    await handler(req, res);
    expect(res._status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(deliver).not.toHaveBeenCalled();
  });

  it("enforces rate limiting", async () => {
    const handler = createWebhookHandler({
      account: makeAccount({ rateLimitPerMinute: 2 }),
      deliver,
    });

    let lastStatus = 0;
    for (let i = 0; i < 3; i++) {
      const req = makeRequest(VALID_PAYLOAD);
      const res = makeResponse();
      await handler(req, res);
      lastStatus = res._status ?? 0;
    }

    // Third request should be rate-limited
    expect(lastStatus).toBe(429);
  });
});
