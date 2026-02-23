/**
 * Gong API Client
 *
 * Direct integration with Gong API v2 for fetching calls, transcripts,
 * and participant data. Uses Basic Auth with the user's own Gong API credentials.
 *
 * Key endpoints used:
 *   GET  /v2/calls              — list calls with date filters
 *   POST /v2/calls/extensive    — detailed call data with participants
 *   POST /v2/calls/transcript   — transcripts with speaker IDs and timestamps
 *   GET  /v2/users              — list internal Gong users
 */

// ─── Gong API Response Types ────────────────────────────────────────────────

export interface GongCall {
  id: string;
  url?: string;
  title?: string;
  duration?: number;
  started?: string;
  parties?: GongParty[];
  media?: { audioUrl?: string; videoUrl?: string };
  scope?: string;
  direction?: string;
  purpose?: string;
}

export interface GongParty {
  id: string;
  emailAddress?: string;
  name?: string;
  affiliation?: "INTERNAL" | "EXTERNAL" | "UNKNOWN";
  speakerId?: string;
  userId?: string;
  context?: Array<{
    system?: string;
    objects?: Array<{
      objectType?: string;
      objectId?: string;
      fields?: Array<{ name: string; value: string }>;
    }>;
  }>;
}

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

export interface GongCallTranscript {
  callId: string;
  transcript: GongTranscriptEntry[];
}

export interface GongTranscriptEntry {
  speakerId?: string;
  topic?: string;
  sentences: Array<{
    start: number; // milliseconds from call start
    end: number;
    text: string;
  }>;
}

interface GongUsersResponse {
  requestId: string;
  records: {
    totalRecords: number;
    currentPageSize: number;
    currentPageNumber: number;
    cursor?: string;
  };
  users: GongUser[];
}

export interface GongUser {
  id: string;
  emailAddress?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  active?: boolean;
  created?: string;
}

// ─── Formatted Output Types ────────────────────────────────────────────────

export interface CallSummary {
  id: string;
  title: string;
  date: string;
  started: string;
  durationMinutes: number;
  url: string | null;
  participants: Array<{
    name: string;
    email: string | null;
    affiliation: string;
    company: string | null;
  }>;
}

export interface FormattedTranscript {
  callId: string;
  callTitle: string;
  callDate: string;
  callStarted: string;
  durationMinutes: number;
  participants: Array<{
    name: string;
    email: string | null;
    affiliation: string;
    company: string | null;
  }>;
  entries: Array<{
    speaker: string;
    affiliation: string;
    timestamp: string;
    timestampMs: number;
    text: string;
  }>;
  markdown: string;
}

export interface StructuredQuote {
  quote_text: string;
  speaker: string;
  affiliation: string;
  timestamp: string;
  timestamp_ms: number;
  call_date: string;
  call_title: string;
  call_id: string;
}

// ─── Client ────────────────────────────────────────────────────────────────

export class GongClient {
  private accessKey: string;
  private accessKeySecret: string;
  private baseUrl: string;

  constructor(config: {
    accessKey: string;
    accessKeySecret: string;
    baseUrl?: string;
  }) {
    this.accessKey = config.accessKey;
    this.accessKeySecret = config.accessKeySecret;
    this.baseUrl = (config.baseUrl ?? "https://api.gong.io").replace(/\/$/, "");
  }

  private get authHeader(): string {
    const encoded = Buffer.from(
      `${this.accessKey}:${this.accessKeySecret}`
    ).toString("base64");
    return `Basic ${encoded}`;
  }

  private async apiGet(path: string): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gong API error (${res.status}): ${text}`);
    }
    return res;
  }

  private async apiPost(path: string, body: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gong API error (${res.status}): ${text}`);
    }
    return res;
  }

  // ─── Search Calls ──────────────────────────────────────────────────────

  /**
   * Search for calls with optional filters. Returns call summaries.
   * Searches by date range and optionally filters by company name
   * or participant email (matched against participant data).
   */
  async searchCalls(filters: {
    fromDate?: string;
    toDate?: string;
    companyName?: string;
    speakerEmail?: string;
    maxResults?: number;
  }): Promise<CallSummary[]> {
    const maxResults = filters.maxResults ?? 100;
    const allCalls: GongCall[] = [];
    let cursor: string | undefined;

    // Use extensive endpoint for full participant data
    do {
      const body: Record<string, unknown> = {};
      if (cursor) body.cursor = cursor;

      const filter: Record<string, unknown> = {};
      if (filters.fromDate) filter.fromDateTime = filters.fromDate;
      if (filters.toDate) filter.toDateTime = filters.toDate;
      if (Object.keys(filter).length > 0) body.filter = filter;

      // Request full party data
      body.contentSelector = {
        exposedFields: {
          parties: true,
          media: true,
          content: {
            brief: true,
          },
        },
      };

      const res = await this.apiPost("/v2/calls/extensive", body);
      const data = (await res.json()) as GongCallsResponse;

      allCalls.push(...data.calls);
      cursor = data.records.cursor;

      if (allCalls.length >= maxResults) break;
    } while (cursor);

    // Apply local filters
    let filtered = allCalls;

    if (filters.companyName) {
      const search = filters.companyName.toLowerCase();
      filtered = filtered.filter((call) =>
        call.parties?.some((p) => {
          // Match against participant name, email domain, or CRM context
          if (p.name?.toLowerCase().includes(search)) return true;
          if (p.emailAddress?.toLowerCase().includes(search)) return true;
          // Check email domain
          const domain = p.emailAddress?.split("@")[1]?.toLowerCase();
          if (domain?.includes(search)) return true;
          // Check CRM context fields for company/account names
          for (const ctx of p.context ?? []) {
            for (const obj of ctx.objects ?? []) {
              for (const field of obj.fields ?? []) {
                if (field.value?.toLowerCase().includes(search)) return true;
              }
            }
          }
          return false;
        })
      );
    }

    if (filters.speakerEmail) {
      const email = filters.speakerEmail.toLowerCase();
      filtered = filtered.filter((call) =>
        call.parties?.some(
          (p) => p.emailAddress?.toLowerCase().includes(email)
        )
      );
    }

    // Convert to summaries
    return filtered.slice(0, maxResults).map((call) => this.toCallSummary(call));
  }

  // ─── Get Transcripts ──────────────────────────────────────────────────

  /**
   * Fetches formatted transcripts for specific call IDs.
   * Resolves speaker IDs to actual names and formats timestamps.
   */
  async getTranscripts(callIds: string[]): Promise<FormattedTranscript[]> {
    if (callIds.length === 0) return [];

    // Fetch call details and transcripts in parallel
    const [calls, transcripts] = await Promise.all([
      this.getCallDetails(callIds),
      this.fetchRawTranscripts(callIds),
    ]);

    const callMap = new Map(calls.map((c) => [c.id, c]));
    const results: FormattedTranscript[] = [];

    for (const ct of transcripts) {
      const call = callMap.get(ct.callId);
      if (!call) continue;

      // Build speaker ID → name map from call parties
      const speakerMap = this.buildSpeakerMap(call);
      const participants = this.extractParticipants(call);
      const callDate = call.started
        ? new Date(call.started).toISOString().split("T")[0]!
        : "Unknown";
      const callTitle = call.title ?? "Untitled Call";

      const entries = ct.transcript.flatMap((entry) =>
        entry.sentences.map((sentence) => {
          const speakerInfo = speakerMap.get(entry.speakerId ?? "");
          return {
            speaker: speakerInfo?.name ?? `Speaker ${entry.speakerId ?? "Unknown"}`,
            affiliation: speakerInfo?.affiliation ?? "UNKNOWN",
            timestamp: formatTimestamp(sentence.start),
            timestampMs: sentence.start,
            text: sentence.text,
          };
        })
      );

      // Build readable markdown for this call
      const markdown = this.buildTranscriptMarkdown(
        callTitle,
        callDate,
        call.duration,
        participants,
        entries
      );

      results.push({
        callId: ct.callId,
        callTitle,
        callDate,
        callStarted: call.started ?? "",
        durationMinutes: call.duration ? Math.round(call.duration / 60) : 0,
        participants,
        entries,
        markdown,
      });
    }

    return results;
  }

  // ─── Extract All Quotes (for spreadsheet export) ──────────────────────

  /**
   * Extracts every utterance from calls as structured quote data.
   * Each sentence becomes a row suitable for CSV/spreadsheet export.
   */
  async extractAllQuotes(callIds: string[]): Promise<StructuredQuote[]> {
    const transcripts = await this.getTranscripts(callIds);
    const quotes: StructuredQuote[] = [];

    for (const t of transcripts) {
      for (const entry of t.entries) {
        if (entry.text.trim().length < 5) continue; // Skip very short utterances
        quotes.push({
          quote_text: entry.text.trim(),
          speaker: entry.speaker,
          affiliation: entry.affiliation,
          timestamp: entry.timestamp,
          timestamp_ms: entry.timestampMs,
          call_date: t.callDate,
          call_title: t.callTitle,
          call_id: t.callId,
        });
      }
    }

    return quotes;
  }

  // ─── Get Users ────────────────────────────────────────────────────────

  /**
   * Lists all Gong users (internal team members).
   */
  async getUsers(): Promise<GongUser[]> {
    const allUsers: GongUser[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);

      const res = await this.apiGet(
        `/v2/users${params.toString() ? `?${params}` : ""}`
      );
      const data = (await res.json()) as GongUsersResponse;
      allUsers.push(...data.users);
      cursor = data.records.cursor;
    } while (cursor);

    return allUsers;
  }

  // ─── Validate Credentials ─────────────────────────────────────────────

  async validateCredentials(): Promise<boolean> {
    try {
      const now = new Date().toISOString();
      await this.apiGet(`/v2/calls?fromDateTime=${now}&toDateTime=${now}`);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private async getCallDetails(callIds: string[]): Promise<GongCall[]> {
    const allCalls: GongCall[] = [];
    // Process in batches of 50 (Gong API limit)
    for (let i = 0; i < callIds.length; i += 50) {
      const batch = callIds.slice(i, i + 50);
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = {
          filter: { callIds: batch },
          contentSelector: {
            exposedFields: {
              parties: true,
              media: true,
            },
          },
        };
        if (cursor) body.cursor = cursor;

        const res = await this.apiPost("/v2/calls/extensive", body);
        const data = (await res.json()) as GongCallsResponse;
        allCalls.push(...data.calls);
        cursor = data.records.cursor;
      } while (cursor);
    }

    return allCalls;
  }

  private async fetchRawTranscripts(
    callIds: string[]
  ): Promise<GongCallTranscript[]> {
    const allTranscripts: GongCallTranscript[] = [];

    // Process in batches of 50
    for (let i = 0; i < callIds.length; i += 50) {
      const batch = callIds.slice(i, i + 50);
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = {
          filter: { callIds: batch },
        };
        if (cursor) body.cursor = cursor;

        const res = await this.apiPost("/v2/calls/transcript", body);
        const data = (await res.json()) as GongTranscriptResponse;
        allTranscripts.push(...data.callTranscripts);
        cursor = data.records.cursor;
      } while (cursor);
    }

    return allTranscripts;
  }

  private buildSpeakerMap(
    call: GongCall
  ): Map<string, { name: string; affiliation: string }> {
    const map = new Map<string, { name: string; affiliation: string }>();
    for (const party of call.parties ?? []) {
      if (party.speakerId) {
        map.set(party.speakerId, {
          name: party.name ?? party.emailAddress ?? `Participant ${party.id}`,
          affiliation: party.affiliation ?? "UNKNOWN",
        });
      }
    }
    return map;
  }

  private extractParticipants(
    call: GongCall
  ): FormattedTranscript["participants"] {
    return (call.parties ?? []).map((p) => {
      // Try to extract company from email domain or CRM context
      let company: string | null = null;
      if (p.emailAddress) {
        const domain = p.emailAddress.split("@")[1];
        if (domain) {
          company = domain.split(".")[0] ?? null;
          if (company) {
            company = company.charAt(0).toUpperCase() + company.slice(1);
          }
        }
      }
      // Check CRM context for account/company name
      for (const ctx of p.context ?? []) {
        for (const obj of ctx.objects ?? []) {
          if (
            obj.objectType?.toLowerCase() === "account" ||
            obj.objectType?.toLowerCase() === "company"
          ) {
            for (const field of obj.fields ?? []) {
              if (
                field.name.toLowerCase() === "name" ||
                field.name.toLowerCase() === "account_name"
              ) {
                company = field.value;
              }
            }
          }
        }
      }

      return {
        name: p.name ?? p.emailAddress ?? "Unknown",
        email: p.emailAddress ?? null,
        affiliation: p.affiliation ?? "UNKNOWN",
        company,
      };
    });
  }

  private toCallSummary(call: GongCall): CallSummary {
    return {
      id: call.id,
      title: call.title ?? "Untitled Call",
      date: call.started
        ? new Date(call.started).toISOString().split("T")[0]!
        : "Unknown",
      started: call.started ?? "",
      durationMinutes: call.duration ? Math.round(call.duration / 60) : 0,
      url: call.url ?? call.media?.videoUrl ?? call.media?.audioUrl ?? null,
      participants: this.extractParticipants(call),
    };
  }

  private buildTranscriptMarkdown(
    callTitle: string,
    callDate: string,
    durationSec: number | undefined,
    participants: FormattedTranscript["participants"],
    entries: FormattedTranscript["entries"]
  ): string {
    const duration = durationSec ? ` (${Math.round(durationSec / 60)} min)` : "";
    const lines: string[] = [];

    lines.push(`## ${callTitle} — ${callDate}${duration}\n`);

    if (participants.length > 0) {
      const participantList = participants
        .map((p) => {
          const role =
            p.affiliation === "INTERNAL" ? " (Internal)" : p.company ? ` (${p.company})` : "";
          return `${p.name}${role}`;
        })
        .join(", ");
      lines.push(`**Participants:** ${participantList}\n`);
    }

    lines.push("---\n");

    for (const entry of entries) {
      const role =
        entry.affiliation === "INTERNAL" ? " [Internal]" : "";
      lines.push(
        `[${entry.timestamp}] **${entry.speaker}**${role}: ${entry.text}`
      );
    }

    return lines.join("\n");
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Converts an array of structured quotes to CSV text.
 */
export function quotesToCsv(quotes: StructuredQuote[]): string {
  const headers = [
    "Quote",
    "Speaker",
    "Affiliation",
    "Timestamp",
    "Call Date",
    "Call Title",
    "Call ID",
  ];

  const escapeField = (value: string): string => {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const rows = quotes.map((q) =>
    [
      escapeField(q.quote_text),
      escapeField(q.speaker),
      escapeField(q.affiliation),
      escapeField(q.timestamp),
      escapeField(q.call_date),
      escapeField(q.call_title),
      escapeField(q.call_id),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}
