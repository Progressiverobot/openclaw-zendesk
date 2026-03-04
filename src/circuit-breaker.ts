/**
 * Simple state-machine circuit breaker for protecting Zendesk API calls.
 *
 * States:
 *   CLOSED    – normal operation; all calls pass through.
 *   OPEN      – failing; calls are blocked until the recovery window elapses.
 *   HALF_OPEN – recovery trial; one call is allowed to test whether the API is back.
 *               Success → CLOSED, failure → OPEN again.
 *
 * Usage:
 *   const cb = new CircuitBreaker("zendesk", 5, 120_000);
 *   if (!cb.isOpen) {
 *     try { const r = await apiCall(); cb.recordSuccess(); }
 *     catch (e) { cb.recordFailure(); throw e; }
 *   }
 *
 * Built by Progressive Robot Ltd
 * https://www.progressiverobot.com
 */

export class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt = 0;

  /**
   * @param name             - Label for log messages.
   * @param failureThreshold - Consecutive failures before opening. Default: 5.
   * @param recoveryMs       - How long (ms) to stay open before a trial. Default: 120 000.
   */
  constructor(
    readonly name: string,
    private readonly failureThreshold = 5,
    private readonly recoveryMs = 120_000,
  ) {}

  /**
   * Returns true when calls should be blocked (circuit is OPEN and the recovery
   * window has not elapsed yet). Automatically transitions to HALF_OPEN once
   * the recovery window elapses.
   */
  get isOpen(): boolean {
    if (this.state === "CLOSED" || this.state === "HALF_OPEN") return false;
    if (Date.now() - this.openedAt >= this.recoveryMs) {
      this.state = "HALF_OPEN";
      return false;
    }
    return true;
  }

  /** Milliseconds the circuit has been open (0 when not OPEN). */
  get openedForMs(): number {
    return this.state === "OPEN" ? Date.now() - this.openedAt : 0;
  }

  /** Current state string. */
  get status(): "CLOSED" | "OPEN" | "HALF_OPEN" {
    return this.state;
  }

  /** Call after a successful API response to reset the failure count. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "CLOSED";
  }

  /**
   * Call after a failed API response (4xx/5xx or thrown error).
   * Opens the circuit once `failureThreshold` consecutive failures are reached,
   * or immediately if in HALF_OPEN state.
   */
  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.state === "HALF_OPEN" || this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = Date.now();
    }
  }

  /** Manually reset to CLOSED (useful in tests or admin commands). */
  reset(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }
}
