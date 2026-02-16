/**
 * Confidence Calibrator
 *
 * Compares the LLM's self-reported confidence scores against a human-labeled
 * validation set, then learns a monotonic mapping function (isotonic regression)
 * that converts raw LLM confidence into calibrated probability.
 *
 * Flow:
 *   1. Validation samples are stored in the DB (chunk text + human-verified tags).
 *   2. `calibrate()` loads all samples, runs them through the tagger, and
 *      compares predicted confidence vs. actual correctness.
 *   3. An isotonic (monotonically non-decreasing) piecewise-linear function
 *      is fit to the (raw_confidence → empirical_accuracy) data.
 *   4. At inference time, `adjustConfidence()` maps raw → calibrated.
 */

import type { PrismaClient } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CalibrationPoint {
  rawConfidence: number;
  empiricalAccuracy: number;
}

export interface CalibrationReport {
  sampleCount: number;
  buckets: Array<{
    rangeStart: number;
    rangeEnd: number;
    count: number;
    meanRawConfidence: number;
    empiricalAccuracy: number;
  }>;
  brierScore: number;
  calibrationCurve: CalibrationPoint[];
}

export interface ValidationSampleInput {
  chunkText: string;
  expectedFunnelStage: string;
  expectedTopic: string;
  organizationId?: string;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class ConfidenceCalibrator {
  private prisma: PrismaClient;

  // Piecewise-linear isotonic calibration mapping
  // Sorted by rawConfidence ascending. Between points, we interpolate linearly.
  private calibrationCurve: CalibrationPoint[] = [];
  private isCalibrated = false;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  // ─── Validation Set Management ──────────────────────────────────────

  /**
   * Add a validation sample (human-labeled ground truth).
   */
  async addValidationSample(sample: ValidationSampleInput): Promise<string> {
    const record = await this.prisma.validationSample.create({
      data: {
        chunkText: sample.chunkText,
        expectedFunnelStage: sample.expectedFunnelStage,
        expectedTopic: sample.expectedTopic,
        organizationId: sample.organizationId ?? null,
      },
    });
    return record.id;
  }

  /**
   * Add multiple validation samples in a batch.
   */
  async addValidationSamples(samples: ValidationSampleInput[]): Promise<number> {
    const result = await this.prisma.validationSample.createMany({
      data: samples.map((s) => ({
        chunkText: s.chunkText,
        expectedFunnelStage: s.expectedFunnelStage,
        expectedTopic: s.expectedTopic,
        organizationId: s.organizationId ?? null,
      })),
    });
    return result.count;
  }

  // ─── Calibration ────────────────────────────────────────────────────

  /**
   * Run the calibration process.
   *
   * Accepts an array of observed (rawConfidence, isCorrect) pairs from a
   * validation pass and fits an isotonic regression curve.
   *
   * @param observations — array of { rawConfidence, isCorrect } from comparing
   *   LLM predictions against ValidationSample ground truth.
   */
  buildCalibration(
    observations: Array<{ rawConfidence: number; isCorrect: boolean }>
  ): CalibrationReport {
    if (observations.length === 0) {
      this.calibrationCurve = [
        { rawConfidence: 0, empiricalAccuracy: 0 },
        { rawConfidence: 1, empiricalAccuracy: 1 },
      ];
      this.isCalibrated = false;
      return {
        sampleCount: 0,
        buckets: [],
        brierScore: 0,
        calibrationCurve: this.calibrationCurve,
      };
    }

    // Sort by raw confidence
    const sorted = [...observations].sort(
      (a, b) => a.rawConfidence - b.rawConfidence
    );

    // ── Bucket into 10 bins for the report ───────────────────────────
    const NUM_BUCKETS = 10;
    const buckets: CalibrationReport["buckets"] = [];

    for (let i = 0; i < NUM_BUCKETS; i++) {
      const rangeStart = i / NUM_BUCKETS;
      const rangeEnd = (i + 1) / NUM_BUCKETS;
      const inBucket = sorted.filter(
        (o) => o.rawConfidence >= rangeStart && o.rawConfidence < rangeEnd
      );
      if (inBucket.length > 0) {
        const meanRaw =
          inBucket.reduce((s, o) => s + o.rawConfidence, 0) / inBucket.length;
        const accuracy =
          inBucket.filter((o) => o.isCorrect).length / inBucket.length;
        buckets.push({
          rangeStart,
          rangeEnd,
          count: inBucket.length,
          meanRawConfidence: meanRaw,
          empiricalAccuracy: accuracy,
        });
      }
    }

    // ── Brier Score ──────────────────────────────────────────────────
    const brierScore =
      sorted.reduce((sum, o) => {
        const actual = o.isCorrect ? 1 : 0;
        return sum + (o.rawConfidence - actual) ** 2;
      }, 0) / sorted.length;

    // ── Isotonic Regression (Pool Adjacent Violators) ────────────────
    this.calibrationCurve = this.fitIsotonicRegression(sorted);
    this.isCalibrated = true;

    return {
      sampleCount: observations.length,
      buckets,
      brierScore,
      calibrationCurve: this.calibrationCurve,
    };
  }

  /**
   * Adjust a raw LLM confidence score using the calibration curve.
   * If not calibrated, returns the raw value unchanged.
   */
  adjustConfidence(rawConfidence: number): number {
    if (!this.isCalibrated || this.calibrationCurve.length === 0) {
      return rawConfidence;
    }

    const curve = this.calibrationCurve;

    // Clamp to [0, 1]
    const clamped = Math.max(0, Math.min(1, rawConfidence));

    // Below first point
    if (clamped <= curve[0].rawConfidence) {
      return curve[0].empiricalAccuracy;
    }
    // Above last point
    if (clamped >= curve[curve.length - 1].rawConfidence) {
      return curve[curve.length - 1].empiricalAccuracy;
    }

    // Linear interpolation between surrounding points
    for (let i = 0; i < curve.length - 1; i++) {
      const lo = curve[i];
      const hi = curve[i + 1];
      if (clamped >= lo.rawConfidence && clamped <= hi.rawConfidence) {
        const range = hi.rawConfidence - lo.rawConfidence;
        if (range === 0) return lo.empiricalAccuracy;
        const t = (clamped - lo.rawConfidence) / range;
        return lo.empiricalAccuracy + t * (hi.empiricalAccuracy - lo.empiricalAccuracy);
      }
    }

    return rawConfidence;
  }

  /**
   * Whether a calibration curve has been fit.
   */
  get calibrated(): boolean {
    return this.isCalibrated;
  }

  /**
   * Load all validation samples from the DB.
   */
  async loadValidationSamples(): Promise<
    Array<{
      id: string;
      chunkText: string;
      expectedFunnelStage: string;
      expectedTopic: string;
    }>
  > {
    return this.prisma.validationSample.findMany({
      select: {
        id: true,
        chunkText: true,
        expectedFunnelStage: true,
        expectedTopic: true,
      },
    });
  }

  // ─── Isotonic Regression (Pool Adjacent Violators Algorithm) ─────

  private fitIsotonicRegression(
    sorted: Array<{ rawConfidence: number; isCorrect: boolean }>
  ): CalibrationPoint[] {
    // Group by raw confidence and compute local accuracy
    const groups: Array<{
      rawConfidence: number;
      value: number;
      weight: number;
    }> = [];

    let i = 0;
    while (i < sorted.length) {
      let j = i;
      // Cluster points with very similar confidence (within 0.01)
      while (j < sorted.length && sorted[j].rawConfidence - sorted[i].rawConfidence < 0.01) {
        j++;
      }
      const slice = sorted.slice(i, j);
      const meanConf =
        slice.reduce((s, o) => s + o.rawConfidence, 0) / slice.length;
      const accuracy =
        slice.filter((o) => o.isCorrect).length / slice.length;
      groups.push({ rawConfidence: meanConf, value: accuracy, weight: slice.length });
      i = j;
    }

    // Pool Adjacent Violators — ensure monotonically non-decreasing
    const blocks: Array<{ value: number; weight: number; startIdx: number; endIdx: number }> = [];

    for (let g = 0; g < groups.length; g++) {
      blocks.push({
        value: groups[g].value,
        weight: groups[g].weight,
        startIdx: g,
        endIdx: g,
      });

      // Merge backwards while violated
      while (blocks.length >= 2) {
        const last = blocks[blocks.length - 1];
        const prev = blocks[blocks.length - 2];
        if (prev.value <= last.value) break;

        // Pool the two blocks
        const totalWeight = prev.weight + last.weight;
        const mergedValue =
          (prev.value * prev.weight + last.value * last.weight) / totalWeight;
        blocks.pop();
        blocks[blocks.length - 1] = {
          value: mergedValue,
          weight: totalWeight,
          startIdx: prev.startIdx,
          endIdx: last.endIdx,
        };
      }
    }

    // Convert blocks back to calibration points
    const curve: CalibrationPoint[] = [];
    for (const block of blocks) {
      // Use the median raw confidence of the groups in this block
      const midIdx = Math.floor((block.startIdx + block.endIdx) / 2);
      curve.push({
        rawConfidence: groups[midIdx].rawConfidence,
        empiricalAccuracy: block.value,
      });
    }

    return curve;
  }
}
