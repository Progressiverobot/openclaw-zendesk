/**
 * Unit tests for account resolution.
 *
 * Run with: pnpm test (vitest)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { listAccountIds, resolveAccount } from "./accounts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCfg(overrides?: Record<string, unknown>) {
  return {
    channels: {
      zendesk: {
        subdomain: "testco",
        agentEmail: "bot@testco.com",
        apiToken: "test-token-abc",
        webhookSecret: "secret123",
        ...overrides,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// listAccountIds
// ---------------------------------------------------------------------------

describe("listAccountIds", () => {
  it("returns [] when channels.zendesk is absent", () => {
    expect(listAccountIds({})).toEqual([]);
  });

  it("returns ['default'] when base config has apiToken", () => {
    expect(listAccountIds(makeCfg())).toEqual(["default"]);
  });

  it("includes named accounts alongside default", () => {
    const cfg = makeCfg({
      accounts: {
        eu: { apiToken: "eu-token", subdomain: "testco-eu", agentEmail: "eu@testco.com" },
      },
    });
    const ids = listAccountIds(cfg);
    expect(ids).toContain("default");
    expect(ids).toContain("eu");
  });

  it("returns only named accounts when base has no token", () => {
    const cfg = {
      channels: {
        zendesk: {
          accounts: {
            prod: { apiToken: "prod-token", subdomain: "prod", agentEmail: "a@b.com" },
          },
        },
      },
    };
    const ids = listAccountIds(cfg);
    expect(ids).toEqual(["prod"]);
    expect(ids).not.toContain("default");
  });
});

// ---------------------------------------------------------------------------
// resolveAccount
// ---------------------------------------------------------------------------

describe("resolveAccount", () => {
  beforeEach(() => {
    // Clear env vars that might bleed from real environment
    delete process.env["ZENDESK_SUBDOMAIN"];
    delete process.env["ZENDESK_AGENT_EMAIL"];
    delete process.env["ZENDESK_API_TOKEN"];
    delete process.env["ZENDESK_WEBHOOK_SECRET"];
  });

  it("resolves base config for default account", () => {
    const account = resolveAccount(makeCfg());
    expect(account.accountId).toBe("default");
    expect(account.subdomain).toBe("testco");
    expect(account.agentEmail).toBe("bot@testco.com");
    expect(account.apiToken).toBe("test-token-abc");
    expect(account.webhookPath).toBe("/webhook/zendesk");
    expect(account.publicReplies).toBe(true);
    expect(account.dmPolicy).toBe("open");
    expect(account.enabled).toBe(true);
  });

  it("applies per-account overrides", () => {
    const cfg = makeCfg({
      accounts: {
        eu: {
          subdomain: "testco-eu",
          agentEmail: "eu@testco.com",
          apiToken: "eu-token",
          publicReplies: false,
        },
      },
    });
    const account = resolveAccount(cfg, "eu");
    expect(account.subdomain).toBe("testco-eu");
    expect(account.agentEmail).toBe("eu@testco.com");
    expect(account.apiToken).toBe("eu-token");
    expect(account.publicReplies).toBe(false);
  });

  it("parses allowedUserIds from comma-separated string", () => {
    const cfg = makeCfg({ allowedUserIds: "111, 222 , 333" });
    const account = resolveAccount(cfg);
    expect(account.allowedUserIds).toEqual(["111", "222", "333"]);
  });

  it("parses allowedUserIds from array", () => {
    const cfg = makeCfg({ allowedUserIds: ["aaa@x.com", "bbb@x.com"] });
    const account = resolveAccount(cfg);
    expect(account.allowedUserIds).toEqual(["aaa@x.com", "bbb@x.com"]);
  });

  it("falls back to env vars when config fields are absent", () => {
    process.env["ZENDESK_SUBDOMAIN"] = "env-co";
    process.env["ZENDESK_AGENT_EMAIL"] = "env@env-co.com";
    process.env["ZENDESK_API_TOKEN"] = "env-token";
    const account = resolveAccount({ channels: { zendesk: {} } });
    expect(account.subdomain).toBe("env-co");
    expect(account.agentEmail).toBe("env@env-co.com");
    expect(account.apiToken).toBe("env-token");
  });

  it("defaults rateLimitPerMinute to 60", () => {
    const account = resolveAccount(makeCfg());
    expect(account.rateLimitPerMinute).toBe(60);
  });

  it("returns empty strings for missing credentials (no crash)", () => {
    const account = resolveAccount({});
    expect(account.subdomain).toBe("");
    expect(account.apiToken).toBe("");
    expect(account.enabled).toBe(true);
  });
});
