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

// ─── Singleton ──────────────────────────────────────────────────────────────

export const metrics = new MetricsCollector();
