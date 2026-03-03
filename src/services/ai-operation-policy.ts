import type { AIOperation } from "@prisma/client";
import type { AIProviderName } from "./ai-client.js";
import { parseAIProviderName } from "./provider-policy.js";

type ResolutionSource = "override" | "org_default" | "operation_default";

export interface AIOperationDefaults {
  provider: AIProviderName;
  model: string;
  temperature: number;
  maxTokens: number;
  jsonMode: boolean;
}

const AI_OPERATION_DEFAULTS: Record<AIOperation, AIOperationDefaults> = {
  STORY_GENERATION: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.3,
    maxTokens: 4000,
    jsonMode: false,
  },
  QUOTE_EXTRACTION: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.1,
    maxTokens: 2000,
    jsonMode: true,
  },
  TRANSCRIPT_TAGGING: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.1,
    maxTokens: 4000,
    jsonMode: true,
  },
  RAG_QUERY: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.2,
    maxTokens: 1500,
    jsonMode: false,
  },
  EMBEDDING: {
    provider: "openai",
    model: "text-embedding-3-small",
    temperature: 0,
    maxTokens: 0,
    jsonMode: false,
  },
};

export interface ResolveOperationModelPolicyInput {
  operation: AIOperation;
  orgDefaultProvider?: unknown;
  orgDefaultModel?: string | null;
  overrideProvider?: AIProviderName;
  overrideModel?: string;
}

export interface ResolvedOperationModelPolicy {
  operation: AIOperation;
  provider: AIProviderName;
  model: string;
  providerSource: ResolutionSource;
  modelSource: ResolutionSource;
}

export interface ResolvedOperationRuntimePolicy {
  operation: AIOperation;
  temperature: number;
  maxTokens: number;
  jsonMode: boolean;
  temperatureSource: ResolutionSource;
  maxTokensSource: ResolutionSource;
  jsonModeSource: ResolutionSource;
}

function normalizeModel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getAIOperationDefaults(operation: AIOperation): AIOperationDefaults {
  return AI_OPERATION_DEFAULTS[operation];
}

export function resolveOperationModelPolicy(
  input: ResolveOperationModelPolicyInput
): ResolvedOperationModelPolicy {
  const defaults = getAIOperationDefaults(input.operation);
  const orgDefaultProvider = parseAIProviderName(input.orgDefaultProvider);
  const orgDefaultModel = normalizeModel(input.orgDefaultModel);
  const overrideModel = normalizeModel(input.overrideModel);

  const provider =
    input.overrideProvider ?? orgDefaultProvider ?? defaults.provider;
  const providerSource: ResolutionSource = input.overrideProvider
    ? "override"
    : orgDefaultProvider
      ? "org_default"
      : "operation_default";

  const model = overrideModel ?? orgDefaultModel ?? defaults.model;
  const modelSource: ResolutionSource = overrideModel
    ? "override"
    : orgDefaultModel
      ? "org_default"
      : "operation_default";

  return {
    operation: input.operation,
    provider,
    model,
    providerSource,
    modelSource,
  };
}

export function resolveOperationRuntimePolicy(input: {
  operation: AIOperation;
  overrideTemperature?: number;
  overrideMaxTokens?: number;
  overrideJsonMode?: boolean;
}): ResolvedOperationRuntimePolicy {
  const defaults = getAIOperationDefaults(input.operation);

  return {
    operation: input.operation,
    temperature: input.overrideTemperature ?? defaults.temperature,
    maxTokens: input.overrideMaxTokens ?? defaults.maxTokens,
    jsonMode: input.overrideJsonMode ?? defaults.jsonMode,
    temperatureSource:
      input.overrideTemperature !== undefined
        ? "override"
        : "operation_default",
    maxTokensSource:
      input.overrideMaxTokens !== undefined ? "override" : "operation_default",
    jsonModeSource:
      input.overrideJsonMode !== undefined ? "override" : "operation_default",
  };
}
