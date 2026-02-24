/**
 * Grain Direct Integration Provider
 *
 * Connects to the Grain API to fetch meeting recordings and transcripts.
 *
 * Auth: Bearer token (OAuth2 or API token)
 * Base URL: https://api.grain.com/_/public-api
 *
 * Grain's API provides:
 *   - List recordings with filters
 *   - Get recording details including transcript + AI notes
 *   - Webhook notifications for new recordings
 *
 * @see https://developers.grain.com/
 */

import type { CallProvider, IntegrationProvider } from "@prisma/client";
import type {
  CallRecordingProvider,
  GrainCredentials,
  NormalizedCall,
  NormalizedParticipant,
  ProviderCredentials,
  SyncResult,
} from "./types.js";

// ─── Grain API Response Types ───────────────────────────────────────────────

interface GrainRecordingsResponse {
  recordings: GrainRecording[];
  cursor?: string;
  has_more?: boolean;
}

interface GrainRecording {
  id: string;
  title?: string;
  url?: string;
  duration?: number; // seconds
  started_at?: string; // ISO 8601
  ended_at?: string;
  participants?: GrainParticipant[];
  transcript?: GrainTranscript;
  status?: string;
}

interface GrainParticipant {
  id?: string;
  email?: string;
  name?: string;
  is_host?: boolean;
  is_organizer?: boolean;
}

interface GrainTranscript {
  text?: string;
  segments?: Array<{
    speaker?: string;
    speaker_email?: string;
    text: string;
    start_time?: number;
    end_time?: number;
  }>;
}

interface GrainRecordingDetail {
  recording: GrainRecording;
}

// ─── Provider Implementation ────────────────────────────────────────────────

function asGrainCredentials(creds: ProviderCredentials): GrainCredentials {
  const c = creds as GrainCredentials;
  if (!c.apiToken) {
    throw new Error("Invalid Grain credentials: missing apiToken");
  }
  return c;
}

export class GrainProvider implements CallRecordingProvider {
  readonly name: IntegrationProvider = "GRAIN";
  readonly callProvider: CallProvider = "GRAIN";

  private baseUrl(creds: GrainCredentials): string {
    return (creds.baseUrl ?? "https://api.grain.com/_/public-api").replace(
      /\/$/,
      ""
    );
  }

  private headers(creds: GrainCredentials): Record<string, string> {
    return {
      Authorization: `Bearer ${creds.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  async validateCredentials(
    credentials: ProviderCredentials
  ): Promise<boolean> {
    const creds = asGrainCredentials(credentials);
    try {
      const res = await fetch(`${this.baseUrl(creds)}/v1/recordings?limit=1`, {
        method: "GET",
        headers: this.headers(creds),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async fetchCalls(
    credentials: ProviderCredentials,
    cursor: string | null,
    since: Date | null,
    _options?: { settings?: Record<string, unknown> | null }
  ): Promise<SyncResult<NormalizedCall>> {
    const creds = asGrainCredentials(credentials);
    const base = this.baseUrl(creds);

    // Build query params
    const params = new URLSearchParams();
    params.set("limit", "50");
    params.set("include_transcript", "true");
    if (cursor) {
      params.set("cursor", cursor);
    }
    if (since) {
      params.set("started_after", since.toISOString());
    }

    const res = await fetch(`${base}/v1/recordings?${params.toString()}`, {
      method: "GET",
      headers: this.headers(creds),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Grain API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as GrainRecordingsResponse;

    const normalized: NormalizedCall[] = data.recordings.map((rec) => ({
      externalId: rec.id,
      title: rec.title ?? null,
      recordingUrl: rec.url ?? null,
      duration: rec.duration ?? null,
      occurredAt: rec.started_at ? new Date(rec.started_at) : new Date(),
      participants: (rec.participants ?? []).map(
        (p): NormalizedParticipant => ({
          email: p.email?.toLowerCase() ?? null,
          name: p.name ?? null,
          isHost: p.is_host ?? p.is_organizer ?? false,
        })
      ),
      transcript: this.extractTranscriptText(rec.transcript),
    }));

    return {
      data: normalized,
      nextCursor: data.cursor ?? null,
      hasMore: data.has_more ?? false,
    };
  }

  async fetchTranscript(
    credentials: ProviderCredentials,
    externalCallId: string
  ): Promise<string | null> {
    const creds = asGrainCredentials(credentials);
    const base = this.baseUrl(creds);

    const res = await fetch(
      `${base}/v1/recordings/${encodeURIComponent(externalCallId)}?include_transcript=true`,
      {
        method: "GET",
        headers: this.headers(creds),
      }
    );

    if (!res.ok) {
      if (res.status === 404) return null;
      const errText = await res.text();
      throw new Error(
        `Grain transcript API error (${res.status}): ${errText}`
      );
    }

    const data = (await res.json()) as GrainRecordingDetail;
    return this.extractTranscriptText(data.recording.transcript);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private extractTranscriptText(
    transcript: GrainTranscript | undefined | null
  ): string | null {
    if (!transcript) return null;

    // Prefer structured segments with speaker attribution
    if (transcript.segments && transcript.segments.length > 0) {
      return transcript.segments
        .map((seg) => {
          const speaker = seg.speaker ?? seg.speaker_email ?? "";
          return speaker ? `${speaker}: ${seg.text}` : seg.text;
        })
        .join("\n");
    }

    // Fall back to plain text
    if (transcript.text?.trim()) {
      return transcript.text;
    }

    return null;
  }
}
