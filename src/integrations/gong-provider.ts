/**
 * Gong Direct Integration Provider
 *
 * Connects to the Gong API v2 to fetch call recordings and transcripts.
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
import {
  buildGongAccountCounts,
  extractGongCallAccountNames,
  gongCallMatchesSelectedAccounts,
} from "./gong-account-utils.js";

const GONG_GLOBAL_HISTORY_START_ISO = "2000-01-01T00:00:00.000Z";

// ─── Gong API Response Types ────────────────────────────────────────────────

interface GongCallsResponse {
  records?: {
    totalRecords?: number;
    currentPageSize?: number;
    currentPageNumber?: number;
    cursor?: string;
  };
  calls: GongCall[];
}

interface GongCall {
  id?: string;
  callId?: string;
  url?: string;
  title?: string;
  duration?: number;
  started?: string;
  metaData?: {
    id?: string;
    callId?: string;
    title?: string;
    duration?: number;
    started?: string;
    url?: string;
    parties?: GongParty[];
    media?: { audioUrl?: string; videoUrl?: string };
    content?: {
      brief?: unknown;
      outline?: unknown;
      highlights?: unknown;
      topics?: unknown;
      summary?: unknown;
    };
    summary?: unknown;
    brief?: unknown;
    aiSummary?: unknown;
    outline?: unknown;
  };
  parties?: GongParty[];
  media?: { audioUrl?: string; videoUrl?: string };
  content?: {
    brief?: unknown;
    outline?: unknown;
    highlights?: unknown;
    topics?: unknown;
    summary?: unknown;
  };
  summary?: unknown;
  brief?: unknown;
  aiSummary?: unknown;
}

interface GongParty {
  id?: string;
  emailAddress?: string;
  email?: string;
  name?: string;
  displayName?: string;
  affiliation?: string;
  speakerId?: string;
  title?: string;
  jobTitle?: string;
  position?: string;
  context?: Array<{
    system?: string;
    objects?: Array<{
      objectType?: string;
      objectId?: string;
      fields?: Array<{ name?: string; value?: string }>;
    }>;
  }>;
}

interface GongTranscriptResponse {
  callTranscripts: GongCallTranscript[];
}

interface GongCallTranscript {
  callId: string;
  transcript: GongTranscriptEntry[];
}

interface GongTranscriptEntry {
  speakerId?: string;
  sentences?: Array<{
    start?: number;
    end?: number;
    text?: string;
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

function normalizeSummaryText(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function outlineItemFromObject(item: Record<string, unknown>): string {
  return normalizeSummaryText(
    item.section ??
      item.title ??
      item.heading ??
      item.name ??
      item.text ??
      item.summary ??
      item.body ??
      item.description ??
      ""
  );
}

function normalizeOutlineItems(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    return value
      .split(/\n|•|- /g)
      .map((line) => normalizeSummaryText(line))
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeOutlineItems(item)).filter(Boolean);
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const heading = outlineItemFromObject(obj);
    const nested = normalizeOutlineItems(
      obj.items ?? obj.sections ?? obj.points ?? obj.bullets ?? obj.outline ?? obj.highlights ?? obj.topics ?? []
    );
    if (heading && nested.length > 0) return [heading, ...nested];
    if (nested.length > 0) return nested;
    return heading ? [heading] : [];
  }
  return [];
}

function extractBrief(call: GongCall): Record<string, unknown> | null {
  const metaData =
    call.metaData && typeof call.metaData === "object" ? call.metaData : {};
  const direct = [
    (metaData.content as Record<string, unknown> | undefined)?.brief,
    (call.content as Record<string, unknown> | undefined)?.brief,
    metaData.brief,
    call.brief,
    (metaData.content as Record<string, unknown> | undefined)?.summary,
    (call.content as Record<string, unknown> | undefined)?.summary,
  ];
  for (const value of direct) {
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function extractSummary(call: GongCall): string {
  const metaData =
    call.metaData && typeof call.metaData === "object" ? call.metaData : {};
  const brief = extractBrief(call);
  const candidates: unknown[] = [
    (metaData.content as Record<string, unknown> | undefined)?.brief,
    (call.content as Record<string, unknown> | undefined)?.brief,
    brief,
    brief?.summary,
    brief?.text,
    brief?.overview,
    brief?.description,
    brief?.executiveSummary,
    metaData.summary,
    metaData.brief,
    metaData.aiSummary,
    call.summary,
    call.brief,
    call.aiSummary,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const text = normalizeSummaryText(candidate);
      if (text) return text;
      continue;
    }
    if (candidate && typeof candidate === "object") {
      const text = normalizeSummaryText(
        (candidate as Record<string, unknown>).summary ??
          (candidate as Record<string, unknown>).text ??
          (candidate as Record<string, unknown>).body ??
          (candidate as Record<string, unknown>).overview ??
          (candidate as Record<string, unknown>).description ??
          ""
      );
      if (text) return text;
    }
  }
  return "";
}

function extractOutline(call: GongCall): string[] {
  const metaData =
    call.metaData && typeof call.metaData === "object" ? call.metaData : {};
  const brief = extractBrief(call);
  const candidates: unknown[] = [
    (metaData.content as Record<string, unknown> | undefined)?.outline,
    (call.content as Record<string, unknown> | undefined)?.outline,
    (metaData.content as Record<string, unknown> | undefined)?.highlights,
    (call.content as Record<string, unknown> | undefined)?.highlights,
    (metaData.content as Record<string, unknown> | undefined)?.topics,
    (call.content as Record<string, unknown> | undefined)?.topics,
    brief?.outline,
    brief?.sections,
    brief?.bullets,
    brief?.highlights,
    brief?.topics,
    metaData.outline,
    (metaData.brief as Record<string, unknown> | undefined)?.outline,
    (metaData.brief as Record<string, unknown> | undefined)?.bullets,
  ];
  for (const candidate of candidates) {
    const outline = normalizeOutlineItems(candidate);
    if (outline.length > 0) return outline;
  }
  return [];
}

function callIdFor(call: GongCall): string | null {
  const idRaw = call.metaData?.id ?? call.id ?? call.metaData?.callId ?? call.callId ?? null;
  const id = idRaw ? String(idRaw).trim() : "";
  return id || null;
}

function selectedAccountsFromSettings(
  settings: Record<string, unknown> | null | undefined
): string[] {
  const rows = settings?.gong_selected_accounts;
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => String(value ?? "").trim()).filter(Boolean);
}

export class GongProvider implements CallRecordingProvider {
  readonly name: IntegrationProvider = "GONG";
  readonly callProvider: CallProvider = "GONG";

  private buildAuthHeader(creds: GongCredentials): string {
    const encoded = Buffer.from(`${creds.accessKey}:${creds.accessKeySecret}`).toString("base64");
    return `Basic ${encoded}`;
  }

  private baseUrl(creds: GongCredentials): string {
    return (creds.baseUrl ?? "https://api.gong.io").replace(/\/$/, "");
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    const creds = asGongCredentials(credentials);
    try {
      const now = new Date().toISOString();
      const res = await fetch(
        `${this.baseUrl(creds)}/v2/calls?fromDateTime=${now}&toDateTime=${now}`,
        {
          method: "GET",
          headers: {
            Authorization: this.buildAuthHeader(creds),
            "Content-Type": "application/json",
          },
        }
      );
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async fetchAccountIndex(
    credentials: ProviderCredentials,
    options?: { maxScanCalls?: number; since?: Date | null }
  ): Promise<{
    generatedAt: string;
    totalCallsIndexed: number;
    totalAccounts: number;
    accounts: Array<{ name: string; count: number }>;
  }> {
    const creds = asGongCredentials(credentials);
    const rawCalls = await this.fetchRawCalls(creds, {
      cursor: null,
      since: options?.since ?? new Date(GONG_GLOBAL_HISTORY_START_ISO),
      maxScanCalls: options?.maxScanCalls ?? 0,
    });
    const accounts = buildGongAccountCounts(rawCalls);
    return {
      generatedAt: new Date().toISOString(),
      totalCallsIndexed: rawCalls.length,
      totalAccounts: accounts.length,
      accounts,
    };
  }

  async fetchCalls(
    credentials: ProviderCredentials,
    cursor: string | null,
    since: Date | null,
    options?: { settings?: Record<string, unknown> | null }
  ): Promise<SyncResult<NormalizedCall>> {
    const creds = asGongCredentials(credentials);
    const selectedAccounts = selectedAccountsFromSettings(options?.settings ?? null);
    const callsData = await this.fetchCallsPage(creds, {
      cursor,
      since,
      includeBriefContent: true,
    });

    const filteredCalls =
      selectedAccounts.length > 0
        ? callsData.calls.filter((call) =>
            gongCallMatchesSelectedAccounts(call, selectedAccounts)
          )
        : callsData.calls;

    const callIds = filteredCalls
      .map((call) => callIdFor(call))
      .filter((id): id is string => Boolean(id));

    const transcriptMap = new Map<string, string>();
    if (callIds.length > 0) {
      try {
        const transcripts = await this.fetchTranscriptsBatch(creds, callIds);
        for (const [id, text] of transcripts) {
          transcriptMap.set(id, text);
        }
      } catch (err) {
        console.warn("Gong: failed to fetch transcript batch", err);
      }
    }

    const normalized: NormalizedCall[] = [];
    for (const call of filteredCalls) {
      const callId = callIdFor(call);
      if (!callId) continue;
      const metaData =
        call.metaData && typeof call.metaData === "object" ? call.metaData : {};
      const media = call.media ?? metaData.media;
      const parties = Array.isArray(call.parties)
        ? call.parties
        : Array.isArray(metaData.parties)
          ? metaData.parties
          : [];
      const accountHints = extractGongCallAccountNames(call);

      normalized.push({
        externalId: callId,
        title: metaData.title ?? call.title ?? null,
        recordingUrl: media?.videoUrl ?? media?.audioUrl ?? metaData.url ?? call.url ?? null,
        duration:
          Number(metaData.duration ?? call.duration) > 0
            ? Number(metaData.duration ?? call.duration)
            : null,
        occurredAt: metaData.started || call.started ? new Date(metaData.started ?? call.started ?? Date.now()) : new Date(),
        participants: parties.map(
          (party): NormalizedParticipant => ({
            email: (party.emailAddress ?? party.email ?? "").toLowerCase() || null,
            name: party.name ?? party.displayName ?? null,
            isHost: String(party.affiliation ?? "").toUpperCase() === "INTERNAL",
            speakerId: party.speakerId ?? party.id ?? null,
            title: party.title ?? party.jobTitle ?? party.position ?? null,
            affiliation: party.affiliation ?? null,
          })
        ),
        transcript: transcriptMap.get(callId) ?? null,
        accountHints,
        primaryAccountHint: accountHints[0] ?? null,
        summary: extractSummary(call) || null,
        outline: extractOutline(call),
      });
    }

    return {
      data: normalized,
      nextCursor: callsData.records?.cursor ?? null,
      hasMore: Boolean(callsData.records?.cursor),
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

  // ─── Private ──────────────────────────────────────────────────────────────

  private async fetchRawCalls(
    creds: GongCredentials,
    input: { cursor: string | null; since: Date | null; maxScanCalls: number }
  ): Promise<GongCall[]> {
    const calls: GongCall[] = [];
    let cursor = input.cursor;
    let includeBriefContent = true;

    do {
      const page = await this.fetchCallsPage(creds, {
        cursor,
        since: input.since,
        includeBriefContent,
      }).catch(async (error) => {
        if (!includeBriefContent) throw error;
        includeBriefContent = false;
        return this.fetchCallsPage(creds, {
          cursor,
          since: input.since,
          includeBriefContent: false,
        });
      });

      for (const call of page.calls) {
        calls.push(call);
        if (input.maxScanCalls > 0 && calls.length >= input.maxScanCalls) {
          return calls;
        }
      }

      cursor = page.records?.cursor ?? null;
    } while (cursor);

    return calls;
  }

  private async fetchCallsPage(
    creds: GongCredentials,
    input: { cursor: string | null; since: Date | null; includeBriefContent: boolean }
  ): Promise<GongCallsResponse> {
    const fromDateTime = (input.since ?? new Date(GONG_GLOBAL_HISTORY_START_ISO)).toISOString();
    const body: Record<string, unknown> = {
      filter: {
        fromDateTime,
        toDateTime: new Date().toISOString(),
      },
      contentSelector: {
        exposedFields: input.includeBriefContent
          ? {
              parties: true,
              media: true,
              content: {
                brief: true,
                outline: true,
                highlights: true,
                topics: true,
              },
            }
          : {
              parties: true,
              media: true,
            },
      },
    };
    if (input.cursor) body.cursor = input.cursor;

    const res = await fetch(`${this.baseUrl(creds)}/v2/calls/extensive`, {
      method: "POST",
      headers: {
        Authorization: this.buildAuthHeader(creds),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gong calls API error (${res.status}): ${errText}`);
    }

    return (await res.json()) as GongCallsResponse;
  }

  private async fetchTranscriptsBatch(
    creds: GongCredentials,
    callIds: string[]
  ): Promise<Map<string, string>> {
    const res = await fetch(`${this.baseUrl(creds)}/v2/calls/transcript`, {
      method: "POST",
      headers: {
        Authorization: this.buildAuthHeader(creds),
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

    for (const row of data.callTranscripts ?? []) {
      const fullText = (row.transcript ?? [])
        .flatMap((entry) =>
          (entry.sentences ?? []).map((sentence) => {
            const line = String(sentence.text ?? "").trim();
            if (!line) return "";
            const speaker = entry.speakerId ? `Speaker ${entry.speakerId}` : "";
            return speaker ? `${speaker}: ${line}` : line;
          })
        )
        .filter(Boolean)
        .join("\n");

      if (fullText) {
        result.set(row.callId, fullText);
      }
    }

    return result;
  }
}
