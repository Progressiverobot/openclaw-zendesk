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
import { CircuitBreaker } from "./circuit-breaker.js";
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
  /** View IDs to poll (numeric strings). Omit when using incremental export. */
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
  /**
   * Use Zendesk Incremental Tickets API instead of per-view polling.
   * One API call per cycle regardless of view count – much more efficient at scale.
   * Fetches all tickets created/updated since the last cursor (defaults to 24 h ago).
   * Default: false.
   */
  useIncrementalExport?: boolean;
  /** Consecutive poll failures before the circuit breaker opens. Default: 5. */
  circuitBreakerThreshold?: number;
  /** Recovery pause (ms) after the circuit opens before a trial request. Default: 120 000. */
  circuitRecoveryMs?: number;
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
// SLA-aware ticket sorter
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Sort tickets by SLA urgency (urgent first) then by age (oldest first). */
function sortBySlaPriority(tickets: ZendeskTicket[]): ZendeskTicket[] {
  return [...tickets].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority ?? ""] ?? 4;
    const pb = PRIORITY_RANK[b.priority ?? ""] ?? 4;
    if (pa !== pb) return pa - pb;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  });
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
    useIncrementalExport = false,
    circuitBreakerThreshold = 5,
    circuitRecoveryMs = 120_000,
  } = opts;

  if (viewIds.length === 0 && !useIncrementalExport) {
    log.info("[zendesk-queue] No view IDs or incremental export configured – queue processor idle.");
    return { stop: () => undefined };
  }

  const seen = new SeenCache();
  const circuit = new CircuitBreaker("[zendesk-queue]", circuitBreakerThreshold, circuitRecoveryMs);
  let stopped = false;
  let backoffMs = pollIntervalMs;
  // Incremental cursor: Unix seconds, starts 24 h ago on first run
  let incrementalCursor = Math.floor((Date.now() - 86_400_000) / 1_000);

  function stop() {
    stopped = true;
  }

  abortSignal?.addEventListener("abort", stop);

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async function poll() {
    if (stopped) return;

    seen.prune();

    if (circuit.isOpen) {
      const remainS = Math.round((circuitRecoveryMs - circuit.openedForMs) / 1_000);
      log.warn(`[zendesk-queue] Circuit open – pausing polling (~${remainS}s remaining)`);
      if (!stopped) setTimeout(() => { void poll(); }, backoffMs);
      return;
    }

    try {
      let candidateTickets: ZendeskTicket[];

      if (useIncrementalExport) {
        const result = await ticketsApi.fetchIncrementalTickets(creds, incrementalCursor);
        if (!result.ok) {
          log.warn(`[zendesk-queue] Incremental export failed: ${result.error}`);
          circuit.recordFailure();
          backoffMs = Math.min(backoffMs * 2, 10 * 60_000);
          if (!stopped) setTimeout(() => { void poll(); }, backoffMs);
          return;
        }
        incrementalCursor = result.endTime;
        candidateTickets = result.tickets.filter(
          (t) => t.status !== "solved" && t.status !== "closed",
        );
        log.info(`[zendesk-queue] Incremental: ${result.count} changed, ${candidateTickets.length} actionable`);
      } else {
        const allTickets: ZendeskTicket[] = [];
        for (const viewId of viewIds) {
          if (stopped) break;
          try {
            const result = await viewsApi.executeView(creds, viewId, { perPage: 50 });
            if (!result.ok) {
              log.warn(`[zendesk-queue] executeView ${viewId} failed: ${result.error}`);
              continue;
            }
            allTickets.push(...result.tickets);
          } catch (viewErr) {
            log.error(`[zendesk-queue] Error polling view ${viewId}:`, viewErr);
          }
        }
        candidateTickets = allTickets;
      }

      // Sort by SLA urgency before dispatching
      const sorted = sortBySlaPriority(candidateTickets);

      for (const ticket of sorted) {
        if (stopped) break;
        const id = String(ticket.id);
        if (seen.has(id)) continue;
        seen.add(id);

        log.info(`[zendesk-queue] Dispatching ticket ${id} (priority: ${ticket.priority ?? "none"})`);

        try {
          await dispatch(ticket);
        } catch (dispatchErr) {
          log.error(`[zendesk-queue] Failed to dispatch ticket ${id}:`, dispatchErr);
        }
      }

      // Successful poll cycle – reset backoff and circuit
      circuit.recordSuccess();
      backoffMs = pollIntervalMs;
    } catch (pollErr) {
      log.error(`[zendesk-queue] Poll error:`, pollErr);
      circuit.recordFailure();
      if (circuit.isOpen) {
        log.warn(
          `[zendesk-queue] Circuit opened after ${circuitBreakerThreshold} failures –` +
          ` pausing for ${circuitRecoveryMs / 1_000}s`,
        );
      }
      backoffMs = Math.min(backoffMs * 2, 10 * 60_000);
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
