/**
 * Application Metrics Collector
 *
 * In-process counters and gauges for StoryEngine operational metrics.
 * These are exposed via the /api/admin/metrics endpoint and can also
 * be exported via OpenTelemetry.
 *
 * Tracks:
 *   - Total calls ingested
 *   - Transcripts processed
 *   - Stories generated
 *   - Landing pages published
 *   - RAG queries served
 *   - Entity resolution hit rates by method
 *   - Average tagging confidence by funnel stage
 */

// ─── Counter Types ──────────────────────────────────────────────────────────

interface EntityResolutionRecord {
  method: "email_domain" | "fuzzy_name" | "none";
  confidence: number;
}

interface TaggingRecord {
  funnelStage: string;
  confidence: number;
}

interface ProcessCallEnqueueFailureRecord {
  timestamp: string;
  source: string;
  callId: string;
  attempts: number;
  error: string;
}

// ─── Metrics Store ──────────────────────────────────────────────────────────

class MetricsCollector {
  // Counters
  private _callsIngested = 0;
  private _transcriptsProcessed = 0;
  private _storiesGenerated = 0;
  private _landingPagesPublished = 0;
  private _ragQueriesServed = 0;

  // Entity resolution tracking
  private _entityResolutions: EntityResolutionRecord[] = [];

  // Tagging confidence tracking
  private _taggingRecords: TaggingRecord[] = [];

  // Process-call enqueue reliability
  private _processCallEnqueueRetryCount = 0;
  private _processCallEnqueueRecoveredCount = 0;
  private _processCallEnqueueFailureCount = 0;
  private _processCallEnqueueFailuresBySource = new Map<string, number>();
  private _processCallEnqueueRecentFailures: ProcessCallEnqueueFailureRecord[] =
    [];

  // Startup time for uptime calculation
  private _startedAt = Date.now();

  // ── Increment Methods ──────────────────────────────────────────────────

  incrementCallsIngested(): void {
    this._callsIngested++;
  }

  incrementTranscriptsProcessed(): void {
    this._transcriptsProcessed++;
  }

  incrementStoriesGenerated(): void {
    this._storiesGenerated++;
  }

  incrementLandingPagesPublished(): void {
    this._landingPagesPublished++;
  }

  incrementRAGQueriesServed(): void {
    this._ragQueriesServed++;
  }

  recordEntityResolution(
    method: "email_domain" | "fuzzy_name" | "none",
    confidence: number
  ): void {
    this._entityResolutions.push({ method, confidence });
    // Keep a sliding window to avoid unbounded memory growth
    if (this._entityResolutions.length > 10_000) {
      this._entityResolutions = this._entityResolutions.slice(-5_000);
    }
  }

  recordTaggingConfidence(funnelStage: string, confidence: number): void {
    this._taggingRecords.push({ funnelStage, confidence });
    if (this._taggingRecords.length > 50_000) {
      this._taggingRecords = this._taggingRecords.slice(-25_000);
    }
  }

  recordProcessCallEnqueueRetry(): void {
    this._processCallEnqueueRetryCount += 1;
  }

  recordProcessCallEnqueueRecovered(): void {
    this._processCallEnqueueRecoveredCount += 1;
  }

  recordProcessCallEnqueueFailure(input: {
    source: string;
    callId: string;
    attempts: number;
    error: string;
  }): void {
    this._processCallEnqueueFailureCount += 1;
    const source = input.source.trim() || "unknown";
    const current = this._processCallEnqueueFailuresBySource.get(source) ?? 0;
    this._processCallEnqueueFailuresBySource.set(source, current + 1);
    this._processCallEnqueueRecentFailures.push({
      timestamp: new Date().toISOString(),
      source,
      callId: input.callId,
      attempts: input.attempts,
      error: input.error,
    });
    if (this._processCallEnqueueRecentFailures.length > 100) {
      this._processCallEnqueueRecentFailures =
        this._processCallEnqueueRecentFailures.slice(-50);
    }
  }

  resetForTesting(): void {
    this._callsIngested = 0;
    this._transcriptsProcessed = 0;
    this._storiesGenerated = 0;
    this._landingPagesPublished = 0;
    this._ragQueriesServed = 0;
    this._entityResolutions = [];
    this._taggingRecords = [];
    this._processCallEnqueueRetryCount = 0;
    this._processCallEnqueueRecoveredCount = 0;
    this._processCallEnqueueFailureCount = 0;
    this._processCallEnqueueFailuresBySource = new Map<string, number>();
    this._processCallEnqueueRecentFailures = [];
    this._startedAt = Date.now();
  }

  // ── Snapshot ────────────────────────────────────────────────────────────

  getSnapshot(): MetricsSnapshot {
    return {
      uptime_seconds: Math.floor((Date.now() - this._startedAt) / 1000),
      counters: {
        calls_ingested: this._callsIngested,
        transcripts_processed: this._transcriptsProcessed,
        stories_generated: this._storiesGenerated,
        landing_pages_published: this._landingPagesPublished,
        rag_queries_served: this._ragQueriesServed,
      },
      entity_resolution: this.computeEntityResolutionRates(),
      tagging_confidence: this.computeTaggingConfidence(),
      queue_observability: this.computeQueueObservability(),
    };
  }

  // ── Private Computations ───────────────────────────────────────────────

  private computeEntityResolutionRates(): EntityResolutionRates {
    const total = this._entityResolutions.length;
    if (total === 0) {
      return {
        total_resolutions: 0,
        hit_rates: {
          email_domain: 0,
          fuzzy_name: 0,
          none: 0,
        },
        average_confidence: {
          email_domain: 0,
          fuzzy_name: 0,
        },
      };
    }

    const byMethod = {
      email_domain: this._entityResolutions.filter(
        (r) => r.method === "email_domain"
      ),
      fuzzy_name: this._entityResolutions.filter(
        (r) => r.method === "fuzzy_name"
      ),
      none: this._entityResolutions.filter((r) => r.method === "none"),
    };

    const avg = (records: EntityResolutionRecord[]) =>
      records.length > 0
        ? Math.round(
            (records.reduce((sum, r) => sum + r.confidence, 0) /
              records.length) *
              1000
          ) / 1000
        : 0;

    return {
      total_resolutions: total,
      hit_rates: {
        email_domain:
          Math.round((byMethod.email_domain.length / total) * 1000) / 1000,
        fuzzy_name:
          Math.round((byMethod.fuzzy_name.length / total) * 1000) / 1000,
        none: Math.round((byMethod.none.length / total) * 1000) / 1000,
      },
      average_confidence: {
        email_domain: avg(byMethod.email_domain),
        fuzzy_name: avg(byMethod.fuzzy_name),
      },
    };
  }

  private computeTaggingConfidence(): TaggingConfidenceByStage {
    const byStage = new Map<string, number[]>();

    for (const record of this._taggingRecords) {
      const existing = byStage.get(record.funnelStage) ?? [];
      existing.push(record.confidence);
      byStage.set(record.funnelStage, existing);
    }

    const result: TaggingConfidenceByStage = {
      total_tags: this._taggingRecords.length,
      by_funnel_stage: {},
    };

    for (const [stage, confidences] of byStage) {
      const avg =
        confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
      result.by_funnel_stage[stage] = {
        count: confidences.length,
        average_confidence: Math.round(avg * 1000) / 1000,
      };
    }

    return result;
  }

  private computeQueueObservability(): QueueObservability {
    const failuresBySource = Object.fromEntries(
      Array.from(this._processCallEnqueueFailuresBySource.entries()).sort(
        ([a], [b]) => a.localeCompare(b)
      )
    );

    return {
      process_call_enqueue: {
        retries: this._processCallEnqueueRetryCount,
        recovered_after_retry: this._processCallEnqueueRecoveredCount,
        failures: this._processCallEnqueueFailureCount,
        failures_by_source: failuresBySource,
        recent_failures: this._processCallEnqueueRecentFailures,
      },
    };
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MetricsSnapshot {
  uptime_seconds: number;
  counters: {
    calls_ingested: number;
    transcripts_processed: number;
    stories_generated: number;
    landing_pages_published: number;
    rag_queries_served: number;
  };
  entity_resolution: EntityResolutionRates;
  tagging_confidence: TaggingConfidenceByStage;
  queue_observability: QueueObservability;
}

interface EntityResolutionRates {
  total_resolutions: number;
  hit_rates: {
    email_domain: number;
    fuzzy_name: number;
    none: number;
  };
  average_confidence: {
    email_domain: number;
    fuzzy_name: number;
  };
}

interface TaggingConfidenceByStage {
  total_tags: number;
  by_funnel_stage: Record<
    string,
    { count: number; average_confidence: number }
  >;
}

interface QueueObservability {
  process_call_enqueue: {
    retries: number;
    recovered_after_retry: number;
    failures: number;
    failures_by_source: Record<string, number>;
    recent_failures: ProcessCallEnqueueFailureRecord[];
  };
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const metrics = new MetricsCollector();
