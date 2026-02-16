/**
 * OpenAI Rate Limiter
 *
 * Token-bucket rate limiter that enforces both RPM (requests per minute)
 * and TPM (tokens per minute) limits for OpenAI API calls.
 *
 * Callers acquire a slot before making a request. If the bucket is exhausted
 * the caller is queued and released when capacity becomes available.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RateLimiterOptions {
  /** Max requests per minute (default: 500 — gpt-4o Tier 1) */
  maxRPM: number;
  /** Max tokens per minute (default: 30 000 — gpt-4o Tier 1) */
  maxTPM: number;
}

interface PendingRequest {
  estimatedTokens: number;
  resolve: () => void;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class RateLimiter {
  private maxRPM: number;
  private maxTPM: number;

  // Current window counters
  private requestsThisWindow = 0;
  private tokensThisWindow = 0;

  // Window timing
  private windowStartMs: number;
  private readonly windowMs = 60_000; // 1 minute

  // Queued callers waiting for capacity
  private queue: PendingRequest[] = [];
  private drainScheduled = false;

  constructor(options: RateLimiterOptions) {
    this.maxRPM = options.maxRPM;
    this.maxTPM = options.maxTPM;
    this.windowStartMs = Date.now();
  }

  /**
   * Rough estimate of token count for a string.
   * Uses the ~4 chars per token heuristic for English text.
   */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Acquire a rate-limit slot. Resolves when the request is allowed to proceed.
   * @param estimatedTokens — estimated total tokens (prompt + completion) for the request
   */
  async acquire(estimatedTokens: number): Promise<void> {
    this.maybeResetWindow();

    // Fast path — capacity available right now
    if (this.canProceed(estimatedTokens)) {
      this.consume(estimatedTokens);
      return;
    }

    // Slow path — queue and wait
    return new Promise<void>((resolve) => {
      this.queue.push({ estimatedTokens, resolve });
      this.scheduleDrain();
    });
  }

  /**
   * Report actual token usage after the API call returns.
   * Adjusts the window counters so subsequent estimates are more accurate.
   */
  reportUsage(actualTokens: number, estimatedTokens: number): void {
    const diff = actualTokens - estimatedTokens;
    if (diff > 0) {
      this.tokensThisWindow += diff;
    }
    // If actual < estimated we don't claw back; conservative is fine.
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private maybeResetWindow(): void {
    const elapsed = Date.now() - this.windowStartMs;
    if (elapsed >= this.windowMs) {
      this.requestsThisWindow = 0;
      this.tokensThisWindow = 0;
      this.windowStartMs = Date.now();
    }
  }

  private canProceed(estimatedTokens: number): boolean {
    return (
      this.requestsThisWindow < this.maxRPM &&
      this.tokensThisWindow + estimatedTokens <= this.maxTPM
    );
  }

  private consume(estimatedTokens: number): void {
    this.requestsThisWindow += 1;
    this.tokensThisWindow += estimatedTokens;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;

    const elapsed = Date.now() - this.windowStartMs;
    const timeUntilReset = Math.max(0, this.windowMs - elapsed);

    // Try to drain every 500ms or at window reset, whichever is sooner
    const delay = Math.min(500, timeUntilReset + 50);

    setTimeout(() => {
      this.drainScheduled = false;
      this.drain();
    }, delay);
  }

  private drain(): void {
    this.maybeResetWindow();

    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (!this.canProceed(next.estimatedTokens)) {
        // Still blocked — reschedule
        this.scheduleDrain();
        return;
      }
      this.queue.shift();
      this.consume(next.estimatedTokens);
      next.resolve();
    }
  }
}
