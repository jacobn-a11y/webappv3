import { describe, it, expect } from "vitest";
import {
  getAIOperationDefaults,
  resolveOperationModelPolicy,
  resolveOperationRuntimePolicy,
} from "./ai-operation-policy.js";

describe("ai-operation-policy model defaults", () => {
  it("falls back to operation defaults when org/request values are absent", () => {
    const resolved = resolveOperationModelPolicy({
      operation: "TRANSCRIPT_TAGGING",
    });

    expect(resolved.provider).toBe("openai");
    expect(resolved.model).toBe("gpt-4o");
    expect(resolved.providerSource).toBe("operation_default");
    expect(resolved.modelSource).toBe("operation_default");
  });

  it("uses org defaults when present", () => {
    const resolved = resolveOperationModelPolicy({
      operation: "STORY_GENERATION",
      orgDefaultProvider: "anthropic",
      orgDefaultModel: "claude-sonnet-4-20250514",
    });

    expect(resolved.provider).toBe("anthropic");
    expect(resolved.model).toBe("claude-sonnet-4-20250514");
    expect(resolved.providerSource).toBe("org_default");
    expect(resolved.modelSource).toBe("org_default");
  });

  it("lets explicit overrides win over org defaults", () => {
    const resolved = resolveOperationModelPolicy({
      operation: "RAG_QUERY",
      orgDefaultProvider: "google",
      orgDefaultModel: "gemini-2.0-flash",
      overrideProvider: "openai",
      overrideModel: "gpt-4o-mini",
    });

    expect(resolved.provider).toBe("openai");
    expect(resolved.model).toBe("gpt-4o-mini");
    expect(resolved.providerSource).toBe("override");
    expect(resolved.modelSource).toBe("override");
  });

  it("ignores invalid org default provider values", () => {
    const resolved = resolveOperationModelPolicy({
      operation: "RAG_QUERY",
      orgDefaultProvider: "azure-openai",
    });

    expect(resolved.provider).toBe("openai");
    expect(resolved.providerSource).toBe("operation_default");
  });
});

describe("ai-operation-policy runtime defaults", () => {
  it("returns operation runtime defaults", () => {
    const defaults = resolveOperationRuntimePolicy({ operation: "RAG_QUERY" });

    expect(defaults.temperature).toBe(0.2);
    expect(defaults.maxTokens).toBe(1500);
    expect(defaults.jsonMode).toBe(false);
    expect(defaults.temperatureSource).toBe("operation_default");
    expect(defaults.maxTokensSource).toBe("operation_default");
    expect(defaults.jsonModeSource).toBe("operation_default");
  });

  it("uses explicit runtime overrides when provided", () => {
    const resolved = resolveOperationRuntimePolicy({
      operation: "STORY_GENERATION",
      overrideTemperature: 0.6,
      overrideMaxTokens: 1200,
      overrideJsonMode: true,
    });

    expect(resolved.temperature).toBe(0.6);
    expect(resolved.maxTokens).toBe(1200);
    expect(resolved.jsonMode).toBe(true);
    expect(resolved.temperatureSource).toBe("override");
    expect(resolved.maxTokensSource).toBe("override");
    expect(resolved.jsonModeSource).toBe("override");
  });

  it("exposes raw defaults for operation lookups", () => {
    const defaults = getAIOperationDefaults("EMBEDDING");
    expect(defaults.model).toBe("text-embedding-3-small");
  });
});
