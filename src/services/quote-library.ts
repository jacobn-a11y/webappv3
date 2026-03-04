import type {
  Prisma,
  PrismaClient,
  Quote,
  QuoteAttributionDisplay,
  QuoteTier,
} from "@prisma/client";
import { decodeDataGovernancePolicy, encodeJsonValue } from "../types/json-boundaries.js";

interface QuoteListFilters {
  organizationId: string;
  userId: string;
  accessibleAccountIds: string[] | null;
  search?: string;
  accountId?: string;
  tier?: QuoteTier | "ALL";
  dateFrom?: Date;
  dateTo?: Date;
  starredOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface QuoteListRow {
  id: string;
  tier: QuoteTier;
  quoteText: string;
  confidenceScore: number;
  createdAt: Date;
  curatedAt: Date | null;
  curationNote: string | null;
  callId: string;
  sourceChunkId: string;
  sourceStartMs: number | null;
  sourceEndMs: number | null;
  account: { id: string; name: string | null };
  call: { id: string; title: string | null; occurredAt: Date };
  isStarred: boolean;
  curatedBy: { id: string; name: string | null; email: string | null } | null;
}

export class QuoteLibraryService {
  constructor(private prisma: PrismaClient) {}

  async listQuotes(filters: QuoteListFilters): Promise<QuoteListRow[]> {
    const where: Prisma.QuoteWhereInput = {
      organizationId: filters.organizationId,
      ...(filters.accessibleAccountIds === null
        ? {}
        : { accountId: { in: filters.accessibleAccountIds } }),
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.tier && filters.tier !== "ALL" ? { tier: filters.tier } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            createdAt: {
              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters.dateTo ? { lte: filters.dateTo } : {}),
            },
          }
        : {}),
      ...(filters.search?.trim()
        ? {
            quoteText: {
              contains: filters.search.trim(),
              mode: "insensitive",
            },
          }
        : {}),
    };

    const rows = await this.prisma.quote.findMany({
      where,
      include: {
        account: { select: { id: true, name: true } },
        call: { select: { id: true, title: true, occurredAt: true } },
        curatedBy: { select: { id: true, name: true, email: true } },
        stars: {
          where: { userId: filters.userId },
          select: { id: true },
        },
      },
      orderBy: [{ tier: "asc" }, { createdAt: "desc" }],
      take: filters.limit ?? 200,
      skip: filters.offset ?? 0,
    });

    const mapped = rows.map((row) => ({
      id: row.id,
      tier: row.tier,
      quoteText: row.quoteText,
      confidenceScore: row.confidenceScore,
      createdAt: row.createdAt,
      curatedAt: row.curatedAt,
      curationNote: row.curationNote,
      callId: row.callId,
      sourceChunkId: row.sourceChunkId,
      sourceStartMs: row.sourceStartMs,
      sourceEndMs: row.sourceEndMs,
      account: {
        id: row.account.id,
        name: row.account.name,
      },
      call: {
        id: row.call.id,
        title: row.call.title,
        occurredAt: row.call.occurredAt,
      },
      isStarred: row.stars.length > 0,
      curatedBy: row.curatedBy
        ? {
            id: row.curatedBy.id,
            name: row.curatedBy.name,
            email: row.curatedBy.email,
          }
        : null,
    }));

    if (!filters.starredOnly) {
      return mapped;
    }
    return mapped.filter((row) => row.isStarred);
  }

  async getAttributionDisplay(
    organizationId: string,
    userId: string
  ): Promise<QuoteAttributionDisplay> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { quoteAttributionDisplay: true },
    });
    return user?.quoteAttributionDisplay ?? "DISPLAYED";
  }

  async setAttributionDisplay(
    organizationId: string,
    userId: string,
    display: QuoteAttributionDisplay
  ): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, organizationId },
      data: { quoteAttributionDisplay: display },
    });
  }

  async createCuratedFromTranscript(input: {
    organizationId: string;
    userId: string;
    callId: string;
    sourceChunkId: string;
    quoteText?: string;
    curationNote?: string;
  }): Promise<Quote> {
    const chunk = await this.prisma.transcriptChunk.findFirst({
      where: {
        id: input.sourceChunkId,
        transcript: {
          callId: input.callId,
          call: { organizationId: input.organizationId },
        },
      },
      include: {
        transcript: {
          include: {
            call: {
              select: {
                id: true,
                organizationId: true,
                accountId: true,
              },
            },
          },
        },
        tags: {
          orderBy: { confidence: "desc" },
          take: 1,
        },
      },
    });

    if (!chunk || !chunk.transcript.call.accountId) {
      throw new Error("Transcript source unavailable for quote save");
    }

    const text = (input.quoteText ?? chunk.text ?? "").trim();
    if (!text) {
      throw new Error("Quote text is required");
    }

    const quote = await this.prisma.quote.create({
      data: {
        organizationId: input.organizationId,
        accountId: chunk.transcript.call.accountId,
        callId: chunk.transcript.call.id,
        quoteText: text,
        sourceChunkId: chunk.id,
        sourceStartMs: chunk.startMs,
        sourceEndMs: chunk.endMs,
        tier: "CURATED",
        createdByType: "USER",
        createdByUserId: input.userId,
        curatedByUserId: input.userId,
        curatedAt: new Date(),
        curationNote: input.curationNote ?? null,
        confidenceScore: chunk.tags[0]?.confidence ?? 0.75,
      },
    });

    await this.logAudit({
      organizationId: input.organizationId,
      quoteId: quote.id,
      actorUserId: input.userId,
      action: "SAVE_FROM_TRANSCRIPT",
      previousTier: null,
      newTier: "CURATED",
      metadata: {
        source_chunk_id: chunk.id,
      },
    });

    return quote;
  }

  async updateTier(input: {
    organizationId: string;
    userId: string;
    quoteId: string;
    nextTier: QuoteTier;
    curationNote?: string;
  }): Promise<Quote> {
    const quote = await this.prisma.quote.findFirst({
      where: {
        id: input.quoteId,
        organizationId: input.organizationId,
      },
      select: {
        id: true,
        tier: true,
        curatedByUserId: true,
      },
    });
    if (!quote) {
      throw new Error("Quote not found");
    }

    if (quote.tier === input.nextTier) {
      return this.prisma.quote.findUniqueOrThrow({ where: { id: input.quoteId } });
    }

    const now = new Date();
    const updated = await this.prisma.quote.update({
      where: { id: input.quoteId },
      data:
        input.nextTier === "CURATED"
          ? {
              tier: "CURATED",
              curatedByUserId: input.userId,
              curatedAt: now,
              curationNote: input.curationNote ?? undefined,
            }
          : {
              tier: "AUTO",
            },
    });

    await this.logAudit({
      organizationId: input.organizationId,
      quoteId: input.quoteId,
      actorUserId: input.userId,
      action: input.nextTier === "CURATED" ? "PROMOTE" : "DEMOTE",
      previousTier: quote.tier,
      newTier: input.nextTier,
    });

    return updated;
  }

  async setStar(input: {
    organizationId: string;
    userId: string;
    quoteId: string;
    starred: boolean;
  }): Promise<void> {
    const quote = await this.prisma.quote.findFirst({
      where: { id: input.quoteId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!quote) {
      throw new Error("Quote not found");
    }

    if (input.starred) {
      await this.prisma.quoteStar.upsert({
        where: {
          userId_quoteId: {
            userId: input.userId,
            quoteId: input.quoteId,
          },
        },
        create: {
          organizationId: input.organizationId,
          userId: input.userId,
          quoteId: input.quoteId,
        },
        update: {},
      });
    } else {
      await this.prisma.quoteStar.deleteMany({
        where: {
          organizationId: input.organizationId,
          userId: input.userId,
          quoteId: input.quoteId,
        },
      });
    }

    await this.logAudit({
      organizationId: input.organizationId,
      quoteId: input.quoteId,
      actorUserId: input.userId,
      action: input.starred ? "STAR" : "UNSTAR",
      metadata: { starred: input.starred },
    });
  }

  async autoExtractForCall(input: {
    organizationId: string;
    callId: string;
    accountId: string | null;
    maxPerCall?: number;
  }): Promise<{ created: number }> {
    if (!input.accountId) {
      return { created: 0 };
    }

    const [call, settings] = await Promise.all([
      this.prisma.call.findFirst({
        where: {
          id: input.callId,
          organizationId: input.organizationId,
          accountId: input.accountId,
        },
        include: {
          transcript: {
            include: {
              chunks: {
                include: {
                  tags: {
                    orderBy: { confidence: "desc" },
                    take: 1,
                  },
                },
                orderBy: { chunkIndex: "asc" },
              },
            },
          },
        },
      }),
      this.prisma.orgSettings.findUnique({
        where: { organizationId: input.organizationId },
        select: { dataGovernancePolicy: true },
      }),
    ]);

    if (!call?.transcript) {
      return { created: 0 };
    }

    if (!this.isEligibleCall(call.title, call.duration)) {
      return { created: 0 };
    }

    const policy = decodeDataGovernancePolicy(settings?.dataGovernancePolicy);
    const dailyCapRaw = (policy as Record<string, unknown>).quote_auto_daily_cap;
    const dailyCap =
      typeof dailyCapRaw === "number" && Number.isFinite(dailyCapRaw)
        ? Math.max(10, Math.floor(dailyCapRaw))
        : 1_000;

    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);

    const [orgCreatedToday, existingForCall] = await Promise.all([
      this.prisma.quote.count({
        where: {
          organizationId: input.organizationId,
          createdByType: "SYSTEM",
          createdAt: { gte: startOfDayUtc },
        },
      }),
      this.prisma.quote.findMany({
        where: {
          organizationId: input.organizationId,
          callId: input.callId,
          createdByType: "SYSTEM",
        },
        select: { quoteText: true, confidenceScore: true, createdAt: true },
      }),
    ]);

    const remainingDaily = Math.max(0, dailyCap - orgCreatedToday);
    if (remainingDaily <= 0) {
      return { created: 0 };
    }

    const maxPerCall = Math.max(1, Math.min(10, input.maxPerCall ?? 10));

    const seen = new Set(
      existingForCall.map((row) => normalizeQuoteText(row.quoteText))
    );

    const byNormalized = new Map<
      string,
      {
        chunkId: string;
        text: string;
        startMs: number | null;
        endMs: number | null;
        confidence: number;
        chunkIndex: number;
      }
    >();

    for (const chunk of call.transcript.chunks) {
      const candidate = deriveCandidateQuote(chunk.text);
      if (!candidate) continue;
      const normalized = normalizeQuoteText(candidate);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      const confidence = chunk.tags[0]?.confidence ?? 0.55;
      const existing = byNormalized.get(normalized);
      if (
        !existing ||
        confidence > existing.confidence ||
        (confidence === existing.confidence && chunk.chunkIndex > existing.chunkIndex)
      ) {
        byNormalized.set(normalized, {
          chunkId: chunk.id,
          text: candidate,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          confidence,
          chunkIndex: chunk.chunkIndex,
        });
      }
    }

    const selected = Array.from(byNormalized.values())
      .sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return a.chunkIndex - b.chunkIndex;
      })
      .slice(0, Math.min(maxPerCall, remainingDaily));

    if (selected.length === 0) {
      return { created: 0 };
    }

    let created = 0;
    for (const row of selected) {
      const quote = await this.prisma.quote.create({
        data: {
          organizationId: input.organizationId,
          accountId: input.accountId,
          callId: input.callId,
          quoteText: row.text,
          sourceChunkId: row.chunkId,
          sourceStartMs: row.startMs,
          sourceEndMs: row.endMs,
          tier: "AUTO",
          createdByType: "SYSTEM",
          confidenceScore: row.confidence,
        },
      });
      created += 1;

      await this.logAudit({
        organizationId: input.organizationId,
        quoteId: quote.id,
        actorUserId: null,
        action: "AUTO_EXTRACT",
        previousTier: null,
        newTier: "AUTO",
        metadata: {
          call_id: input.callId,
          source_chunk_id: row.chunkId,
          confidence: row.confidence,
        },
      });
    }

    return { created };
  }

  private isEligibleCall(title: string | null, durationSec: number | null): boolean {
    const minDurationSec = 8 * 60;
    if ((durationSec ?? 0) < minDurationSec) {
      return false;
    }

    if (!title) {
      return true;
    }

    const allowlist = ["discovery", "demo", "qbr", "implementation", "review"];
    const lower = title.toLowerCase();
    return allowlist.some((token) => lower.includes(token));
  }

  private async logAudit(input: {
    organizationId: string;
    quoteId: string;
    actorUserId?: string | null;
    action:
      | "CREATE"
      | "AUTO_EXTRACT"
      | "SAVE_FROM_TRANSCRIPT"
      | "PROMOTE"
      | "DEMOTE"
      | "STAR"
      | "UNSTAR";
    previousTier?: QuoteTier | null;
    newTier?: QuoteTier | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.quoteAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        quoteId: input.quoteId,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        previousTier: input.previousTier ?? null,
        newTier: input.newTier ?? null,
        metadata: input.metadata ? encodeJsonValue(input.metadata) : undefined,
      },
    });
  }
}

const GREETING_PATTERN =
  /\b(hello|hi there|good morning|good afternoon|thanks for joining|can you hear me|quick sync)\b/i;

function deriveCandidateQuote(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length < 70 || cleaned.length > 400) {
    return null;
  }
  if (GREETING_PATTERN.test(cleaned)) {
    return null;
  }

  const sentence = cleaned
    .split(/(?<=[.!?])\s+/)
    .find((part) => part.trim().length >= 50);
  const chosen = (sentence ?? cleaned).trim();
  if (chosen.length < 50) {
    return null;
  }
  return chosen.slice(0, 320);
}

function normalizeQuoteText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
