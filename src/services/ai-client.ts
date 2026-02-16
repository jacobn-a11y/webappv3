/**
 * AI Client Abstraction Layer
 *
 * Provides a unified interface for LLM chat completions across multiple
 * providers (OpenAI, Anthropic, Google). This abstraction allows org admins
 * to choose their preferred AI provider and model for story generation,
 * transcript tagging, and RAG queries.
 *
 * Embedding remains tied to OpenAI (text-embedding-3-small) since existing
 * Pinecone vectors are OpenAI-based. Switching embedding models would require
 * re-indexing all vectors.
 */

import OpenAI from "openai";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AIClient {
  chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
  readonly providerName: string;
  readonly modelName: string;
}

export type AIProviderName = "openai" | "anthropic" | "google";

/** Known models per provider, for UI display and validation. */
export const PROVIDER_MODELS: Record<AIProviderName, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "o1", "o1-mini", "o3-mini"],
  anthropic: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-35-20241022", "claude-3-5-sonnet-20241022"],
  google: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
};

export const DEFAULT_MODELS: Record<AIProviderName, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
};

// ─── OpenAI Client ───────────────────────────────────────────────────────────

export class OpenAIClient implements AIClient {
  private client: OpenAI;
  readonly providerName = "openai";
  readonly modelName: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({ apiKey });
    this.modelName = model ?? "gpt-4o";
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4000,
      messages: options.messages,
      ...(options.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    });

    const content = response.choices[0]?.message?.content ?? "";
    const usage = response.usage;

    return {
      content,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    };
  }
}

// ─── Anthropic Client ────────────────────────────────────────────────────────

export class AnthropicClient implements AIClient {
  private apiKey: string;
  readonly providerName = "anthropic";
  readonly modelName: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.modelName = model ?? "claude-sonnet-4-20250514";
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    // Anthropic uses a separate system parameter rather than a system message
    const systemMessages = options.messages.filter((m) => m.role === "system");
    const nonSystemMessages = options.messages.filter((m) => m.role !== "system");

    const systemText = systemMessages.map((m) => m.content).join("\n\n");

    // Ensure messages alternate user/assistant (Anthropic requirement)
    const anthropicMessages = nonSystemMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: this.modelName,
      max_tokens: options.maxTokens ?? 4000,
      messages: anthropicMessages,
    };

    if (systemText) {
      body.system = systemText;
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const content = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    return {
      content,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    };
  }
}

// ─── Google Gemini Client ────────────────────────────────────────────────────

export class GoogleGeminiClient implements AIClient {
  private apiKey: string;
  readonly providerName = "google";
  readonly modelName: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.modelName = model ?? "gemini-2.0-flash";
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const systemMessages = options.messages.filter((m) => m.role === "system");
    const nonSystemMessages = options.messages.filter((m) => m.role !== "system");

    const systemText = systemMessages.map((m) => m.content).join("\n\n");

    // Map messages to Gemini format
    const contents = nonSystemMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxTokens ?? 4000,
        ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };

    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google Gemini API error (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      candidates: Array<{
        content: { parts: Array<{ text: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
      };
    };

    const content =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";

    return {
      content,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
    };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates an AIClient for a given provider, API key, and model.
 */
export function createAIClient(
  provider: AIProviderName,
  apiKey: string,
  model?: string
): AIClient {
  switch (provider) {
    case "openai":
      return new OpenAIClient(apiKey, model);
    case "anthropic":
      return new AnthropicClient(apiKey, model);
    case "google":
      return new GoogleGeminiClient(apiKey, model);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}
