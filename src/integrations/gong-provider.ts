/**
 * Gong Direct Integration Provider
 *
 * Connects to the Gong API v2 to fetch call recordings and transcripts.
 *
 * Auth: Basic Auth (access key + secret)
 * Base URL: https://api.gong.io/v2
 * Rate limit: ~1,000 requests/hour per API key
 *
 * Key endpoints:
 *   GET  /v2/calls              — list calls with date filters
 *   POST /v2/calls/extensive    — detailed call data with participants
 *   POST /v2/calls/transcript   — transcripts for a set of call IDs
 *
 * @see https://gong.app.gong.io/settings/api/documentation
 */

import type { CallProvider, IntegrationProvider } from "@prisma/client";
import type {
  CallRecordingProvider,
  GongCredentials,
  NormalizedCall,
  NormalizedParticipant,
  ProviderCredentials,
  SyncResult,
} from "./types.js";

// ─── Gong API Response Types ────────────────────────────────────────────────

interface GongCallsResponse {
  requestId: string;
  records: {
    totalRecords: number;
    currentPageSize: number;
    currentPageNumber: number;
    cursor?: string;
  };
  calls: GongCall[];
}

interface GongCall {
  id: string;
  url?: string;
  title?: string;
  duration?: number; // seconds
  started?: string; // ISO 8601
  parties?: GongParty[];
  media?: { audioUrl?: string; videoUrl?: string };
}

interface GongParty {
  id: string;
  emailAddress?: string;
  name?: string;
  affiliation?: "INTERNAL" | "EXTERNAL" | "UNKNOWN";
  speakerId?: string;
  context?: Array<{ system?: string; objects?: Array<{ objectType?: string; objectId?: string; fields?: Array<{ name: string; value: string }> }> }>;
}

interface GongTranscriptResponse {
  requestId: string;
  records: {
    totalRecords: number;
    currentPageSize: number;
    currentPageNumber: number;
    cursor?: string;
  };
  callTranscripts: GongCallTranscript[];
}

interface GongCallTranscript {
  callId: string;
  transcript: GongTranscriptEntry[];
}

interface GongTranscriptEntry {
  speakerId?: string;
  topic?: string;
  sentences: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

// ─── Provider Implementation ────────────────────────────────────────────────

function asGongCredentials(creds: ProviderCredentials): GongCredentials {
  const c = creds as GongCredentials;
  if (!c.accessKey || !c.accessKeySecret) {
    throw new Error("Invalid Gong credentials: missing accessKey or accessKeySecret");
  }
  return c;
}

export class GongProvider implements CallRecordingProvider {
  readonly name: IntegrationProvider = "GONG";
  readonly callProvider: CallProvider = "GONG";

  private buildAuthHeader(creds: GongCredentials): string {
    const encoded = Buffer.from(
      `${creds.accessKey}:${creds.accessKeySecret}`
    ).toString("base64");
    return `Basic ${encoded}`;
  }

  private baseUrl(creds: GongCredentials): string {
    return (creds.baseUrl ?? "https://api.gong.io").replace(/\/$/, "");
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    const creds = asGongCredentials(credentials);
    try {
      const res = await fetch(`${this.baseUrl(creds)}/v2/calls?fromDateTime=${new Date().toISOString()}&toDateTime=${new Date().toISOString()}`, {
        method: "GET",
        headers: {
          Authorization: this.buildAuthHeader(creds),
          "Content-Type": "application/json",
        },
      });
      // 200 = valid creds, even if no calls returned
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async fetchCalls(
    credentials: ProviderCredentials,
    cursor: string | null,
    since: Date | null
  ): Promise<SyncResult<NormalizedCall>> {
    const creds = asGongCredentials(credentials);
    const base = this.baseUrl(creds);
    const auth = this.buildAuthHeader(creds);

    // Step 1: Fetch call list using the extensive endpoint for full participant data
    const body: Record<string, unknown> = {};
    if (cursor) {
      body.cursor = cursor;
    }
    if (since) {
      body.filter = {
        fromDateTime: since.toISOString(),
      };
    }

    const callsRes = await fetch(`${base}/v2/calls/extensive`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!callsRes.ok) {
      const errText = await callsRes.text();
      throw new Error(`Gong API error (${callsRes.status}): ${errText}`);
    }

    const callsData = (await callsRes.json()) as GongCallsResponse;
    const callIds = callsData.calls.map((c) => c.id);

    // Step 2: Fetch transcripts for these calls
    const transcriptMap = new Map<string, string>();
    if (callIds.length > 0) {
      try {
        const transcripts = await this.fetchTranscriptsBatch(creds, callIds);
        for (const [id, text] of transcripts) {
          transcriptMap.set(id, text);
        }
      } catch (err) {
        // Log but don't fail — calls without transcripts are still valuable
        console.warn("Gong: Failed to fetch transcripts batch:", err);
      }
    }

    // Step 3: Normalize
    const normalized: NormalizedCall[] = callsData.calls.map((call) => ({
      externalId: call.id,
      title: call.title ?? null,
      recordingUrl: call.media?.videoUrl ?? call.media?.audioUrl ?? call.url ?? null,
      duration: call.duration ?? null,
      occurredAt: call.started ? new Date(call.started) : new Date(),
      participants: (call.parties ?? []).map(
        (p): NormalizedParticipant => ({
          email: p.emailAddress?.toLowerCase() ?? null,
          name: p.name ?? null,
          isHost: p.affiliation === "INTERNAL",
        })
      ),
      transcript: transcriptMap.get(call.id) ?? null,
    }));

    return {
      data: normalized,
      nextCursor: callsData.records.cursor ?? null,
      hasMore: !!callsData.records.cursor,
    };
  }

  async fetchTranscript(
    credentials: ProviderCredentials,
    externalCallId: string
  ): Promise<string | null> {
    const creds = asGongCredentials(credentials);
    const map = await this.fetchTranscriptsBatch(creds, [externalCallId]);
    return map.get(externalCallId) ?? null;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async fetchTranscriptsBatch(
    creds: GongCredentials,
    callIds: string[]
  ): Promise<Map<string, string>> {
    const base = this.baseUrl(creds);
    const auth = this.buildAuthHeader(creds);

    const res = await fetch(`${base}/v2/calls/transcript`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { callIds },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gong transcript API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as GongTranscriptResponse;
    const result = new Map<string, string>();

    for (const ct of data.callTranscripts) {
      const fullText = ct.transcript
        .flatMap((entry) =>
          entry.sentences.map((s) => {
            const speaker = entry.speakerId ? `Speaker ${entry.speakerId}` : "";
            return speaker ? `${speaker}: ${s.text}` : s.text;
          })
        )
        .join("\n");

      if (fullText.trim()) {
        result.set(ct.callId, fullText);
      }
    }

    return result;
  }
}
