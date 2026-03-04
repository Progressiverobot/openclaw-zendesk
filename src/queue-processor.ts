/**
 * Autonomous Zendesk ticket queue processor.
 *
 * Polls configured views on a schedule, deduplicates tickets, enriches
 * context, and dispatches each new ticket into the OpenClaw agent pipeline
 * for fully autonomous resolution – no human agent required.
 *
 * Built by Progressive Robot Ltd
 * https://www.progressiverobot.com
 */

import * as viewsApi from "./api/views.js";
import * as ticketsApi from "./api/tickets.js";
import type { ZendeskTicket } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ZdCredsLike {
  subdomain: string;
  agentEmail: string;
  apiToken: string;
}

export interface QueueProcessorOptions {
  /** Zendesk credentials. */
  creds: ZdCredsLike;
  /** View IDs to poll (numeric strings). Omit to skip polling. */
  viewIds?: string[];
  /** Polling interval in milliseconds (default 30 000). */
  pollIntervalMs?: number;
  /**
   * Called once per new ticket.  The channel.ts gateway wires this to the
   * same dispatch logic used by the webhook handler.
   */
  dispatch: (ticket: ZendeskTicket) => Promise<void>;
  /** AbortSignal to stop the queue when the account shuts down. */
  abortSignal?: AbortSignal;
  /** Logger (defaults to console). */
  log?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };
}

export interface QueueProcessor {
  /** Stop polling and clean up. */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Deduplication cache with TTL
// ---------------------------------------------------------------------------

interface SeenEntry {
  seenAt: number;
}

class SeenCache {
  private map = new Map<string, SeenEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = 60 * 60 * 1000 /* 1 hour */) {
    this.ttlMs = ttlMs;
  }

  has(id: string): boolean {
    const entry = this.map.get(id);
    if (!entry) return false;
    if (Date.now() - entry.seenAt > this.ttlMs) {
      this.map.delete(id);
      return false;
    }
    return true;
  }

  add(id: string): void {
    this.map.set(id, { seenAt: Date.now() });
  }

  /** Prune expired entries (call periodically). */
  prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, entry] of this.map) {
      if (entry.seenAt < cutoff) this.map.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Queue processor factory
// ---------------------------------------------------------------------------

export function startQueueProcessor(opts: QueueProcessorOptions): QueueProcessor {
  const {
    creds,
    viewIds = [],
    pollIntervalMs = 30_000,
    dispatch,
    abortSignal,
    log = console,
  } = opts;

  if (viewIds.length === 0) {
    log.info("[zendesk-queue] No view IDs configured – queue processor idle.");
    return { stop: () => undefined };
  }

  const seen = new SeenCache();
  let stopped = false;
  let backoffMs = pollIntervalMs;

  function stop() {
    stopped = true;
  }

  abortSignal?.addEventListener("abort", stop);

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async function poll() {
    if (stopped) return;

    seen.prune();

    for (const viewId of viewIds) {
      if (stopped) break;
      try {
        const result = await viewsApi.executeView(creds, viewId, { perPage: 50 });
        if (!result.ok) {
          log.warn(`[zendesk-queue] executeView ${viewId} failed: ${result.error}`);
          continue;
        }

        for (const ticket of result.tickets) {
          const id = String(ticket.id);
          if (seen.has(id)) continue;
          seen.add(id);

          log.info(`[zendesk-queue] New ticket ${id} from view ${viewId}`);

          try {
            const detail = await ticketsApi.getTicket(creds, id);
            if (!detail.ok) {
              log.warn(`[zendesk-queue] Could not fetch ticket ${id}: ${detail.error}`);
              continue;
            }
            await dispatch(detail.ticket);
          } catch (dispatchErr) {
            log.error(`[zendesk-queue] Failed to dispatch ticket ${id}:`, dispatchErr);
          }
        }

        // Successful poll – reset backoff
        backoffMs = pollIntervalMs;
      } catch (viewErr) {
        log.error(`[zendesk-queue] Error polling view ${viewId}:`, viewErr);
        // Exponential backoff up to 10 minutes
        backoffMs = Math.min(backoffMs * 2, 10 * 60 * 1000);
      }
    }

    if (!stopped) {
      setTimeout(() => { void poll(); }, backoffMs);
    }
  }

  // Start first poll after one interval to allow gateway to fully start
  const initialTimer = setTimeout(() => { void poll(); }, pollIntervalMs);

  return {
    stop() {
      clearTimeout(initialTimer);
      stop();
    },
  };
}
