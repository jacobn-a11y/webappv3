/**
 * Account Journey Service
 *
 * Fetches all calls for an account chronologically and assembles them into
 * a unified timeline interleaved with Salesforce CRM events (opportunity
 * stage changes, wins, losses, etc.).
 *
 * Also retrieves CRM sidebar data (account info, contacts, key metrics).
 */

import type { PrismaClient, FunnelStage, CallProvider, SalesforceEventType } from "@prisma/client";
import { TOPIC_LABELS, type TaxonomyTopic } from "../types/taxonomy.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimelineCallNode {
  type: "call";
  id: string;
  date: string; // ISO string
  title: string | null;
  provider: CallProvider;
  duration: number | null; // seconds
  participants: {
    id: string;
    name: string | null;
    email: string | null;
    isHost: boolean;
    title: string | null; // contact title if resolved
  }[];
  tags: {
    funnelStage: FunnelStage;
    topic: string;
    topicLabel: string;
    confidence: number;
  }[];
  /** Dominant funnel stage (highest confidence or most tags) */
  primaryStage: FunnelStage | null;
}

export interface TimelineCrmEventNode {
  type: "crm_event";
  id: string;
  date: string; // ISO string
  eventType: SalesforceEventType;
  stageName: string | null;
  opportunityId: string | null;
  amount: number | null;
  description: string | null;
}

export type TimelineNode = TimelineCallNode | TimelineCrmEventNode;

export interface AccountCrmSidebar {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: number | null;
  salesforceId: string | null;
  hubspotId: string | null;
  contactCount: number;
  callCount: number;
  totalCallMinutes: number;
  storyCount: number;
  topContacts: {
    id: string;
    name: string | null;
    email: string;
    title: string | null;
    callAppearances: number;
  }[];
}

export interface AccountJourneyData {
  account: AccountCrmSidebar;
  timeline: TimelineNode[];
  /** Summary counts by funnel stage */
  stageCounts: Record<string, number>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class AccountJourneyService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Fetches the full account journey data: CRM sidebar info + unified timeline.
   */
  async getAccountJourney(
    accountId: string,
    organizationId: string
  ): Promise<AccountJourneyData> {
    // Account CRM data
    const accountPromise = this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: {
        _count: {
          select: { contacts: true, calls: true },
        },
      },
    });

    // All calls for this account, ordered chronologically
    const callsPromise = this.prisma.call.findMany({
      where: { accountId, organizationId },
      include: {
        participants: {
          include: {
            contact: {
              select: { title: true },
            },
          },
        },
        tags: {
          orderBy: { confidence: "desc" },
        },
      },
      orderBy: { occurredAt: "asc" },
    });

    // Salesforce events for the account
    const eventsPromise = this.prisma.salesforceEvent.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
    });

    // Story count
    const storyCountPromise = this.prisma.story.count({
      where: { accountId, organizationId },
    });

    // Top contacts by call appearances
    const participationPromise = this.prisma.callParticipant.groupBy({
      by: ["contactId"],
      where: {
        call: { accountId, organizationId },
        contactId: { not: null },
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    });

    // Await all in parallel (separate variables preserve Prisma types)
    const account = await accountPromise;
    const calls = await callsPromise;
    const salesforceEvents = await eventsPromise;
    const storyCount = await storyCountPromise;
    const contactParticipationRaw = await participationPromise;

    // Verify org ownership
    if (account.organizationId !== organizationId) {
      throw new Error("Account does not belong to this organization");
    }

    // Resolve top contacts
    const topContactIds = contactParticipationRaw
      .filter((c) => c.contactId !== null)
      .map((c) => c.contactId!);

    const contactDetails =
      topContactIds.length > 0
        ? await this.prisma.contact.findMany({
            where: { id: { in: topContactIds } },
            select: { id: true, name: true, email: true, title: true },
          })
        : [];

    const contactMap = new Map(contactDetails.map((c) => [c.id, c]));
    const participationMap = new Map(
      contactParticipationRaw.map((c) => [c.contactId!, c._count.id])
    );

    const topContacts = topContactIds
      .map((id: string) => {
        const contact = contactMap.get(id);
        if (!contact) return null;
        return {
          id: contact.id,
          name: contact.name,
          email: contact.email,
          title: contact.title,
          callAppearances: participationMap.get(id) ?? 0,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // Calculate total call minutes
    const totalCallMinutes = calls.reduce(
      (sum: number, c) => sum + (c.duration ? Math.round(c.duration / 60) : 0),
      0
    );

    // Build sidebar
    const sidebar: AccountCrmSidebar = {
      id: account.id,
      name: account.name,
      domain: account.domain,
      industry: account.industry,
      employeeCount: account.employeeCount,
      annualRevenue: account.annualRevenue,
      salesforceId: account.salesforceId,
      hubspotId: account.hubspotId,
      contactCount: account._count.contacts,
      callCount: account._count.calls,
      totalCallMinutes,
      storyCount,
      topContacts,
    };

    // Build call timeline nodes
    const callNodes: TimelineCallNode[] = calls.map((call) => {
      const primaryStage = this.getPrimaryStage(call.tags);

      return {
        type: "call" as const,
        id: call.id,
        date: call.occurredAt.toISOString(),
        title: call.title,
        provider: call.provider,
        duration: call.duration,
        participants: call.participants.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          isHost: p.isHost,
          title: p.contact?.title ?? null,
        })),
        tags: call.tags.map((t) => ({
          funnelStage: t.funnelStage,
          topic: t.topic,
          topicLabel:
            TOPIC_LABELS[t.topic as TaxonomyTopic] ?? t.topic,
          confidence: t.confidence,
        })),
        primaryStage,
      };
    });

    // Build CRM event timeline nodes
    const crmNodes: TimelineCrmEventNode[] = salesforceEvents.map((evt) => ({
      type: "crm_event" as const,
      id: evt.id,
      date: (evt.closeDate ?? evt.createdAt).toISOString(),
      eventType: evt.eventType,
      stageName: evt.stageName,
      opportunityId: evt.opportunityId,
      amount: evt.amount,
      description: evt.description,
    }));

    // Merge and sort by date
    const timeline: TimelineNode[] = [...callNodes, ...crmNodes].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Compute stage counts
    const stageCounts: Record<string, number> = {};
    for (const node of callNodes) {
      if (node.primaryStage) {
        stageCounts[node.primaryStage] =
          (stageCounts[node.primaryStage] ?? 0) + 1;
      }
    }

    return { account: sidebar, timeline, stageCounts };
  }

  /**
   * Determines the dominant funnel stage for a call based on its tags.
   * Uses a count-then-confidence approach.
   */
  private getPrimaryStage(
    tags: { funnelStage: FunnelStage; confidence: number }[]
  ): FunnelStage | null {
    if (tags.length === 0) return null;

    const stageScores = new Map<FunnelStage, number>();
    for (const tag of tags) {
      stageScores.set(
        tag.funnelStage,
        (stageScores.get(tag.funnelStage) ?? 0) + tag.confidence
      );
    }

    let best: FunnelStage | null = null;
    let bestScore = -1;
    for (const [stage, score] of stageScores) {
      if (score > bestScore) {
        bestScore = score;
        best = stage;
      }
    }

    return best;
  }
}
