/**
 * Taxonomy Validation Tests
 *
 * Validates that taxonomy constants are properly defined and
 * that validation against known values works correctly.
 * This prevents LLM prompt injection through invalid taxonomy values.
 */

import { describe, it, expect } from "vitest";
import {
  FunnelStage,
  VALID_FUNNEL_STAGES,
  ALL_TOPICS,
  TOFU_TOPICS,
  MOFU_TOPICS,
  BOFU_TOPICS,
  POST_SALE_TOPICS,
  INTERNAL_TOPICS,
  VERTICAL_TOPICS,
  TOPIC_LABELS,
  STAGE_TOPICS,
} from "./taxonomy.js";

describe("Taxonomy", () => {
  describe("VALID_FUNNEL_STAGES", () => {
    it("should contain all FunnelStage enum values", () => {
      const enumValues = Object.values(FunnelStage);
      for (const value of enumValues) {
        expect(VALID_FUNNEL_STAGES).toContain(value);
      }
    });

    it("should match the FunnelStage enum exactly", () => {
      expect(VALID_FUNNEL_STAGES).toHaveLength(Object.values(FunnelStage).length);
    });
  });

  describe("ALL_TOPICS", () => {
    it("should contain all topics from each stage", () => {
      const expected = [
        ...TOFU_TOPICS,
        ...MOFU_TOPICS,
        ...BOFU_TOPICS,
        ...POST_SALE_TOPICS,
        ...INTERNAL_TOPICS,
        ...VERTICAL_TOPICS,
      ];
      expect(ALL_TOPICS).toEqual(expected);
    });

    it("should have no duplicate topics", () => {
      const unique = new Set(ALL_TOPICS);
      expect(unique.size).toBe(ALL_TOPICS.length);
    });

    it("should have a label for every topic", () => {
      for (const topic of ALL_TOPICS) {
        expect(TOPIC_LABELS[topic]).toBeDefined();
        expect(typeof TOPIC_LABELS[topic]).toBe("string");
        expect(TOPIC_LABELS[topic].length).toBeGreaterThan(0);
      }
    });
  });

  describe("STAGE_TOPICS mapping", () => {
    it("should map each FunnelStage to its topics", () => {
      expect(STAGE_TOPICS[FunnelStage.TOFU]).toEqual(TOFU_TOPICS);
      expect(STAGE_TOPICS[FunnelStage.MOFU]).toEqual(MOFU_TOPICS);
      expect(STAGE_TOPICS[FunnelStage.BOFU]).toEqual(BOFU_TOPICS);
      expect(STAGE_TOPICS[FunnelStage.POST_SALE]).toEqual(POST_SALE_TOPICS);
      expect(STAGE_TOPICS[FunnelStage.INTERNAL]).toEqual(INTERNAL_TOPICS);
      expect(STAGE_TOPICS[FunnelStage.VERTICAL]).toEqual(VERTICAL_TOPICS);
    });
  });

  describe("Input validation", () => {
    it("should reject invalid funnel stages", () => {
      const invalidStages = [
        "INVALID",
        "tofu", // lowercase
        "SQL_INJECTION",
        "'; DROP TABLE accounts; --",
        "",
      ];
      for (const stage of invalidStages) {
        expect(
          (VALID_FUNNEL_STAGES as readonly string[]).includes(stage)
        ).toBe(false);
      }
    });

    it("should reject invalid topics", () => {
      const invalidTopics = [
        "not_a_real_topic",
        "sql_injection",
        "'; DROP TABLE --",
        "__proto__",
        "constructor",
      ];
      for (const topic of invalidTopics) {
        expect((ALL_TOPICS as readonly string[]).includes(topic)).toBe(false);
      }
    });

    it("should accept valid funnel stages", () => {
      for (const stage of VALID_FUNNEL_STAGES) {
        expect(
          (VALID_FUNNEL_STAGES as readonly string[]).includes(stage)
        ).toBe(true);
      }
    });
  });
});
