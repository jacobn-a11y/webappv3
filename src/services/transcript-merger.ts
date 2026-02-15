/**
 * Transcript Merger
 *
 * Merges all transcripts from a single account (client) into one continuous
 * Markdown document, ordered chronologically by call date.
 *
 * If the merged result exceeds the configured word limit, entire calls are
 * dropped from either the oldest or newest end (depending on truncation mode)
 * until the document fits within the limit.
 */

import type { PrismaClient, TranscriptTruncationMode } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MergedTranscriptOptions {
  accountId: string;
  organizationId: string;
  /** Override the org-level max word count. */
  maxWords?: number;
  /** Override the org-level truncation mode. */
  truncationMode?: TranscriptTruncationMode;
  /** Only include calls on or after this date. */
  afterDate?: Date;
  /** Only include calls on or before this date. */
  beforeDate?: Date;
}

export interface MergedTranscriptResult {
  markdown: string;
  wordCount: number;
  totalCalls: number;
  includedCalls: number;
  truncated: boolean;
  /** If truncated, the date boundary where content was cut. */
  truncationBoundary: Date | null;
  truncationMode: TranscriptTruncationMode;
}

interface CallTranscriptEntry {
  callId: string;
  title: string | null;
  occurredAt: Date;
  duration: number | null;
  participants: Array<{ name: string | null; email: string | null; isHost: boolean }>;
  fullText: string;
  wordCount: number;
}

// ─── Default Configuration ───────────────────────────────────────────────────

/**
 * Default max word count for merged transcript markdown.
 * Based on 80% of the 1M token context window available in the most
 * cutting-edge commercially available models (GPT-4.1, Gemini 2.5 Pro,
 * Claude Opus 4.6 extended) as of February 2026.
 *
 * 1M tokens × 0.8 = 800K tokens ≈ 600,000 words (at ~0.75 words/token).
 */
export const DEFAULT_TRANSCRIPT_MERGE_MAX_WORDS = 600_000;

export const DEFAULT_TRUNCATION_MODE: TranscriptTruncationMode = "OLDEST_FIRST";

// ─── Transcript Merger ──────────────────────────────────────────────────────

export class TranscriptMerger {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Merges all transcripts for an account into a single Markdown document.
   *
   * Calls are ordered chronologically. Each call becomes a section with
   * metadata (date, title, participants, duration) followed by the full
   * transcript text.
   *
   * If the total word count exceeds the configured limit, entire calls
   * are dropped from the oldest or newest end until the document fits.
   */
  async mergeTranscripts(
    options: MergedTranscriptOptions
  ): Promise<MergedTranscriptResult> {
    const { accountId, organizationId } = options;

    // Load org settings for defaults
    const orgSettings = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
    });

    const maxWords =
      options.maxWords ??
      orgSettings?.transcriptMergeMaxWords ??
      DEFAULT_TRANSCRIPT_MERGE_MAX_WORDS;

    const truncationMode =
      options.truncationMode ??
      orgSettings?.transcriptTruncationMode ??
      DEFAULT_TRUNCATION_MODE;

    // Fetch all calls with transcripts for this account, ordered by date
    const dateFilter: Record<string, unknown> = {};
    if (options.afterDate) dateFilter.gte = options.afterDate;
    if (options.beforeDate) dateFilter.lte = options.beforeDate;

    const calls = await this.prisma.call.findMany({
      where: {
        accountId,
        organizationId,
        transcript: { isNot: null },
        ...(Object.keys(dateFilter).length > 0
          ? { occurredAt: dateFilter }
          : {}),
      },
      include: {
        transcript: true,
        participants: {
          select: { name: true, email: true, isHost: true },
        },
      },
      orderBy: { occurredAt: "asc" },
    });

    // Build entries with word counts
    const entries: CallTranscriptEntry[] = calls
      .filter((c) => c.transcript)
      .map((c) => ({
        callId: c.id,
        title: c.title,
        occurredAt: c.occurredAt,
        duration: c.duration,
        participants: c.participants,
        fullText: c.transcript!.fullText,
        wordCount: c.transcript!.wordCount,
      }));

    const totalCalls = entries.length;

    if (totalCalls === 0) {
      return {
        markdown: "",
        wordCount: 0,
        totalCalls: 0,
        includedCalls: 0,
        truncated: false,
        truncationBoundary: null,
        truncationMode,
      };
    }

    // Apply truncation if needed
    const { included, truncated, truncationBoundary } = this.applyTruncation(
      entries,
      maxWords,
      truncationMode
    );

    // Build the merged Markdown
    const markdown = this.buildMarkdown(included);
    const wordCount = countWords(markdown);

    return {
      markdown,
      wordCount,
      totalCalls,
      includedCalls: included.length,
      truncated,
      truncationBoundary,
      truncationMode,
    };
  }

  /**
   * Drops entire calls from the specified end until the total word count
   * fits within maxWords. Returns the included entries and truncation info.
   */
  private applyTruncation(
    entries: CallTranscriptEntry[],
    maxWords: number,
    mode: TranscriptTruncationMode
  ): {
    included: CallTranscriptEntry[];
    truncated: boolean;
    truncationBoundary: Date | null;
  } {
    // Calculate total words including markdown overhead (~30 words per call header)
    const HEADER_OVERHEAD = 30;
    let totalWords = entries.reduce(
      (sum, e) => sum + e.wordCount + HEADER_OVERHEAD,
      0
    );

    if (totalWords <= maxWords) {
      return { included: entries, truncated: false, truncationBoundary: null };
    }

    // Need to truncate: make a mutable copy
    const included = [...entries];
    let truncationBoundary: Date | null = null;

    if (mode === "OLDEST_FIRST") {
      // Drop oldest calls first (from the beginning of the sorted list)
      while (
        included.length > 1 &&
        totalWords > maxWords
      ) {
        const dropped = included.shift()!;
        totalWords -= dropped.wordCount + HEADER_OVERHEAD;
        truncationBoundary = dropped.occurredAt;
      }
    } else {
      // NEWEST_FIRST: Drop newest calls first (from the end)
      while (
        included.length > 1 &&
        totalWords > maxWords
      ) {
        const dropped = included.pop()!;
        totalWords -= dropped.wordCount + HEADER_OVERHEAD;
        truncationBoundary = dropped.occurredAt;
      }
    }

    return { included, truncated: true, truncationBoundary };
  }

  /**
   * Renders a list of call transcript entries into a single Markdown document.
   */
  private buildMarkdown(entries: CallTranscriptEntry[]): string {
    const sections: string[] = [];

    // Document header
    const firstDate = entries[0].occurredAt.toISOString().split("T")[0];
    const lastDate =
      entries[entries.length - 1].occurredAt.toISOString().split("T")[0];

    sections.push(
      `# Merged Transcripts (${entries.length} calls, ${firstDate} to ${lastDate})\n`
    );

    for (const entry of entries) {
      const date = entry.occurredAt.toISOString().split("T")[0];
      const title = entry.title ?? "Untitled Call";
      const duration = entry.duration
        ? ` (${Math.round(entry.duration / 60)} min)`
        : "";

      // Call header
      sections.push(`---\n`);
      sections.push(`## ${title} — ${date}${duration}\n`);

      // Participants
      if (entry.participants.length > 0) {
        const participantList = entry.participants
          .map((p) => {
            const name = p.name ?? p.email ?? "Unknown";
            return p.isHost ? `**${name}** (host)` : name;
          })
          .join(", ");
        sections.push(`**Participants:** ${participantList}\n`);
      }

      // Transcript body
      sections.push(entry.fullText);
      sections.push(""); // blank line separator
    }

    return sections.join("\n");
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}
